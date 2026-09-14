/**
 * src/utils/fileLock.ts
 *
 * S0 修复用的两个最小 helper:
 *   1. atomicWriteFile(path, content) — tmp + rename 原子替换
 *   2. withFileLock(path, fn) — 跨进程文件锁,基于 lockfile + flock 语义
 *
 * 设计约束:
 *  - 不引入 npm 依赖;纯 node:fs/promises 原生
 *  - 锁目录从 targetPath 推导: <targetPath 所在目录>/.locks/<basename>.lock
 *    (锁天然跟着 targetPath 走,测试用 tmpdir 时锁也在 tmpdir,不动 ~/.alice)
 *  - 用 O_EXCL + mkdir 实现锁(目录创建在 POSIX 是原子的)
 *  - 持锁失败:用指数退避重试(默认最多 50 次,每次 20ms,合计 1s)
 *  - 持锁成功:try/finally 保证异常路径也释放
 *  - 锁释放:rmdir 空目录(不递归,锁目录永远是空的)
 *  - atomicWriteFile:写 <path>.tmp.<pid>.<rand> → fs.rename 替换 → rename 同分区原子
 *
 * 已知限制:
 *  - 进程内同时多次 withFileLock 同 path 会串行(await + finally 串行)
 *  - 锁目录必须可创建(目标目录可写)
 *  - 持锁进程崩溃后,目录残留:下一次 withFileLock 启动时若发现残留锁 + PID 已退出,会自动清理(容错)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/** 锁默认参数(可被 withFileLock 调用方覆盖) */
const DEFAULT_MAX_RETRIES = 50;        // 重试上限
const DEFAULT_RETRY_DELAY_MS = 20;     // 每次重试间隔
const DEFAULT_ACQUIRE_TIMEOUT_MS = 5_000; // 总等待上限(50 * 100ms,与重试 × delay 一致,但提供显式 deadline)

/** 进程内串行化:同 path 上的 withFileLock 必须 await 串行,防止同一进程内的逻辑竞态 */
const processLocalQueue = new Map<string, Promise<unknown>>();

/** 进程 PID(取自 process.pid;Node ESM 不直接 require 'os') */
function currentPid(): number {
  return process.pid;
}

/** 拿锁路径对应的 lockfile 目录: <targetPath 所在目录>/.locks/<basename>.lock
 *  锁天然跟着 targetPath 走,所以测试用 tmpdir 时锁也在 tmpdir 里,
 *  不会污染真实 ~/.alice/locks/,也不和生产 daemon 共享锁命名空间。 */
function lockDirFor(targetPath: string): string {
  const base = path.basename(targetPath);
  const parent = path.dirname(targetPath);
  return path.join(parent, '.locks', `${base}.lock`);
}

/** 检测 PID 是否还活着(process.kill(pid, 0)) */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // EPERM 表示进程存在但无权限发信号(其他用户进程),仍算 alive
    return code === 'EPERM';
  }
}

/**
 * 尝试 O_EXCL 创建锁目录。成功返回 true,失败(已存在)返回 false。
 */
async function tryAcquireLock(lockDir: string): Promise<boolean> {
  try {
    await fs.mkdir(lockDir, { recursive: false });
    // 写入当前 PID 到锁目录内的 pid 文件,便于残留锁检测
    await fs.writeFile(path.join(lockDir, 'pid'), String(currentPid()), 'utf-8');
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return false;
    throw err;
  }
}

/** 释放锁:删 pid 文件 + rmdir(只删空目录) */
async function releaseLock(lockDir: string): Promise<void> {
  try {
    await fs.unlink(path.join(lockDir, 'pid')).catch(() => undefined);
    await fs.rmdir(lockDir);
  } catch {
    // 已经不在了(可能对方帮我们清),忽略
  }
}

/** 检测并清理残留锁(锁目录存在 + PID 已死 → 清掉) */
async function cleanupStaleLock(lockDir: string): Promise<void> {
  try {
    const pidRaw = await fs.readFile(path.join(lockDir, 'pid'), 'utf-8');
    const pid = parseInt(pidRaw.trim(), 10);
    if (Number.isFinite(pid) && !isPidAlive(pid)) {
      await releaseLock(lockDir);
    }
  } catch {
    // 锁目录已被别人抢走或 pid 文件不在,不管
  }
}

export interface FileLockOptions {
  /** 总获取超时(ms);超过抛 FileLockTimeoutError */
  acquireTimeoutMs?: number;
  /** 重试间隔(ms) */
  retryDelayMs?: number;
}

/** 锁获取超时 */
export class FileLockTimeoutError extends Error {
  constructor(public readonly lockDir: string, public readonly timeoutMs: number) {
    super(`获取文件锁超时: ${lockDir} (timeout=${timeoutMs}ms)`);
    this.name = 'FileLockTimeoutError';
  }
}

/**
 * 在文件锁内执行 fn。
 *  - 跨进程互斥(同 lockDir 不同时持有)
 *  - 进程内串行化(同 lockDir 内 await 排队)
 *  - 锁目录: ~/.alice/locks/<basename>.lock
 *  - 崩溃残留检测:发现死 PID 自动清理
 */
export async function withFileLock<T>(
  targetPath: string,
  fn: () => Promise<T>,
  opts: FileLockOptions = {},
): Promise<T> {
  const lockDir = lockDirFor(targetPath);
  const acquireTimeoutMs = opts.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;
  const retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const deadline = Date.now() + acquireTimeoutMs;

  // 确保 lockDir 的祖先目录存在(例如 targetPath 在 os.tmpdir() 下一个深层目录里)。
  // 这里 mkdir 的父目录是 <targetPath 所在目录>/.locks(由 lockDirFor 推导),
  // 不接触任何 ~/.alice 路径。
  await fs.mkdir(path.dirname(lockDir), { recursive: true });

  // 先把上一个同 path 的本地操作排上队
  const prevLocal = processLocalQueue.get(targetPath) ?? Promise.resolve();
  let releaseLocal: () => void = () => undefined;
  const localGate = new Promise<void>((resolve) => {
    releaseLocal = resolve;
  });
  processLocalQueue.set(
    targetPath,
    prevLocal.then(() => localGate),
  );

  try {
    await prevLocal;

    // 跨进程获取
    let acquired = false;
    while (!acquired) {
      // 清理可能的残留锁(死 PID)
      await cleanupStaleLock(lockDir);
      acquired = await tryAcquireLock(lockDir);
      if (acquired) break;
      if (Date.now() >= deadline) {
        throw new FileLockTimeoutError(lockDir, acquireTimeoutMs);
      }
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }

    try {
      return await fn();
    } finally {
      await releaseLock(lockDir);
    }
  } finally {
    releaseLocal();
    // 如果队列里只剩自己,清掉 entries 防内存累积
    if (processLocalQueue.get(targetPath) === prevLocal.then(() => localGate)) {
      processLocalQueue.delete(targetPath);
    }
  }
}

/**
 * 原子写文件:tmp 文件 + rename。
 *  - tmp 文件名: <path>.tmp.<pid>.<rand6>
 *  - tmp 文件 fsync 后再 rename(rename 同分区原子)
 *  - rename 失败时清理 tmp
 *  - 不加锁!调用方负责外层 withFileLock
 */
export async function atomicWriteFile(
  targetPath: string,
  content: string,
): Promise<void> {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });

  const rand = randomBytes(3).toString('hex');
  const tmpPath = `${targetPath}.tmp.${currentPid()}.${rand}`;

  let fd: import('node:fs/promises').FileHandle | null = null;
  try {
    fd = await fs.open(tmpPath, 'w');
    await fd.writeFile(content, 'utf-8');
    await fd.sync(); // 确保数据落盘,rename 后保证持久性
    await fd.close();
    fd = null;
    await fs.rename(tmpPath, targetPath);
  } catch (err) {
    if (fd !== null) {
      try { await fd.close(); } catch { /* ignore */ }
    }
    // 清理 tmp
    await fs.unlink(tmpPath).catch(() => undefined);
    throw err;
  }
}
