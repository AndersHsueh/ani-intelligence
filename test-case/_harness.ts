/**
 * test-case/_harness.ts
 *
 * 测试用例共享的极简 harness + 文件系统 helper。
 *
 * 内容:
 *  - assert / section:  极简断言 + 阶段打印
 *  - withTmpDir:       自动清理的临时目录
 *  - withHomeSentinel: 验证"本次测试不写 HOME"的小工具
 *
 * 使用方式(test-raw-slicer.ts / test-watermark.ts):
 *
 *     const { passed, failed } = makeCounters();
 *     const assert = makeAssert(passed, failed);
 *     const section = makeSection();
 *     const withTmpDir = makeWithTmpDir();
 *     const withHomeSentinel = makeWithHomeSentinel();
 *
 * 为什么不直接 export 默认 instance:每个测试文件独立计数,
 * 避免全局状态污染;也避免多个测试并行跑时计数器串。
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';

// ---------- 断言与阶段 ----------

export interface Counters {
  passed: number;
  failed: number;
  failures: string[];
}

export function makeCounters(): Counters {
  return { passed: 0, failed: 0, failures: [] };
}

export function makeAssert(counters: Counters) {
  return (cond: unknown, msg: string): void => {
    if (cond) {
      counters.passed++;
      console.log(`  ✓ ${msg}`);
    } else {
      counters.failed++;
      counters.failures.push(msg);
      console.log(`  ✗ ${msg}`);
    }
  };
}

export function makeSection() {
  return (name: string): void => {
    console.log(`\n── ${name} ──`);
  };
}

/** 打印汇总并按 failed 决定 exit code。 */
export function summarize(counters: Counters, prefix = '  '): void {
  console.log(`\n── 总结 ──`);
  console.log(`${prefix}passed: ${counters.passed}`);
  console.log(`${prefix}failed: ${counters.failed}`);
  if (counters.failed > 0) {
    console.log(`\n失败明细:`);
    for (const f of counters.failures) console.log(`${prefix}- ${f}`);
    process.exit(1);
  } else {
    console.log(`${prefix}✓ all green`);
  }
}

// ---------- 文件系统 helper ----------

export function makeWithTmpDir() {
  return async function withTmpDir<T>(
    prefix: string,
    fn: (dir: string) => Promise<T>,
  ): Promise<T> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    try {
      return await fn(dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  };
}

/**
 * 验证指定函数执行期间 HOME 下没有产生某个 sentinel 文件。
 * 在 fn 执行前 / 后各 stat 一次 sentinel,断言 after 之前不存在。
 *
 * @param prefix sentinel 文件名前缀(如 `.alice-rs-test-sentinel-`)
 * @param fn    要执行的测试块
 */
export async function withHomeSentinel<T>(
  prefix: string,
  fn: () => Promise<T>,
): Promise<T> {
  const sentinel = path.join(
    os.homedir(),
    `${prefix}-${process.pid}-${Date.now()}`,
  );
  let beforeExists = false;
  try {
    await fs.stat(sentinel);
    beforeExists = true;
  } catch {
    beforeExists = false;
  }

  const result = await fn();

  let afterExists = false;
  try {
    await fs.stat(sentinel);
    afterExists = true;
  } catch {
    afterExists = false;
  }

  if (afterExists) {
    // 清理意外写入的 sentinel(不要让它污染用户 HOME)
    await fs.rm(sentinel, { force: true });
    throw new Error(
      `HOME 哨兵文件在 fn 执行后存在 (sentinel=${sentinel});fn 写到了 HOME!`,
    );
  }

  return result;
}