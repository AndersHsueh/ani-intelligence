/**
 * src/runtime/workspace/watermark.ts
 *
 * P1 · 收集层 —— 水位线推进器
 *
 * 维护 projectRoot/.watermark.json,供未来 ingest / 切片消费方推进用。
 *
 * 职责:
 *  - readWatermark(projectRoot):读当前水位线;文件不存在返回 null。
 *  - advanceWatermark(projectRoot, next):把水位线推进到 next,原子写。
 *
 * 硬边界(与 P0 memoryWikiPaths 同源思路):
 *  - 原子写:tmp 文件 + rename。主文件永远是有效 JSON 或不存在;绝无"半写"。
 *  - 幂等:同样的 next 连续推进两次,主文件字节级相等。
 *  - 不写到 os.homedir() 下任何路径(HOME 一律 throw)。
 *  - 不调任何 LLM / 网络 / 不动 daemon / agentLoop。
 *  - 不修改已有 raw/wiki/outputs 文件。
 *
 * 与 P0 的差异:
 *  - P0 暴露三个目录的"约定";本文件只暴露水位线状态。
 *  - P0 的 appendMemoryWikiGitignore 对 HOME 是 silent no-op;本文件一律 throw。
 *    理由:水位线丢失 = 消费方需要重新对齐,这必须被显式看到,不能"假装没事"。
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

/** 水位线文件名(相对 projectRoot) */
const WATERMARK_FILENAME = '.watermark.json';

/** tmp 文件后缀长度(hex 字符) */
const TMP_HEX_LEN = 8;

export class WatermarkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WatermarkError';
  }
}

/**
 * 水位线状态:任意可 JSON 序列化的对象。
 * 调用方负责 schema 定义;本模块不约束字段。
 */
export type WatermarkState = Record<string, unknown>;

/**
 * 解析 projectRoot 并做输入校验。
 *  - 必须是非空字符串
 *  - 拒绝 NUL 字节(规避路径注入)
 *  - 解析为绝对路径
 */
function resolveRoot(projectRoot: string): string {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new WatermarkError('refuse: projectRoot is empty');
  }
  if (projectRoot.includes('\0')) {
    throw new WatermarkError('refuse: projectRoot contains NUL byte');
  }
  return path.resolve(projectRoot);
}

/**
 * 校验目标路径在解析后仍位于 root 之下。
 * 任何 ../ 跳出或绝对路径都拒绝。沿用 P0 同名思路(未引用 P0 私有函数)。
 */
function assertInsideRoot(root: string, target: string): void {
  const rel = path.relative(root, target);
  if (rel.length === 0) {
    throw new WatermarkError(`refuse: target equals projectRoot`);
  }
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new WatermarkError(
      `refuse: path escapes projectRoot: root=${root} target=${target}`,
    );
  }
}

function watermarkPath(root: string): string {
  const target = path.join(root, WATERMARK_FILENAME);
  assertInsideRoot(root, target);
  return target;
}

/**
 * 读当前水位线。
 *  - 文件不存在:返回 null(初始状态,允许)。
 *  - 文件存在但不是有效 JSON:抛 WatermarkError。
 *    理由:水位线若坏掉,意味着上轮原子写失败或被外部破坏;消费方应被告知,
 *    而不是"透明"重建一个空状态掩盖问题。
 */
export async function readWatermark(
  projectRoot: string,
): Promise<WatermarkState | null> {
  const root = resolveRoot(projectRoot);
  if (root === os.homedir()) {
    throw new WatermarkError(`refuse: projectRoot equals HOME (${root})`);
  }
  const p = watermarkPath(root);

  let raw: string;
  try {
    raw = await fs.readFile(p, 'utf-8');
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code === 'ENOENT') return null;
    throw e;
  }

  try {
    return JSON.parse(raw) as WatermarkState;
  } catch (e) {
    throw new WatermarkError(
      `corrupt watermark file (invalid JSON): ${p} (${(e as Error).message})`,
    );
  }
}

/**
 * 内部:原子地把 body 写入 targetFile。
 *
 * 流程:
 *  1) 在同 fs 内生成 `.watermark.json.tmp-<8hex>` 临时文件,wx 创建
 *  2) 写 body,fsync 刷盘
 *  3) close 句柄
 *  4) rename tmp 到 target(同 fs 下原子覆盖)
 *
 * 失败处理:
 *  - 写 tmp / fsync 失败:清理 tmp,抛错
 *  - rename 失败:清理 tmp,抛错(主文件保持旧值)
 *  - 整个过程不依赖目标文件"先存在"
 *
 * 并发:本函数不做并发锁;同 fs 下 rename 原子覆盖 = 最后写入者胜出。
 * 这与"水位线最新值优先"语义一致;消费方按自己需要的原子性再加锁。
 *
 * @internal 测试可见(export 是为了让 test-watermark 直接验证原子写原语),
 *           生产代码应只通过 advanceWatermark 调用。
 */
export async function writeJsonAtomic(
  targetFile: string,
  body: string,
): Promise<void> {
  const dir = path.dirname(targetFile);
  const base = path.basename(targetFile);
  const tmpName = `${base}.tmp-${crypto.randomBytes(TMP_HEX_LEN / 2).toString('hex')}`;
  const tmpPath = path.join(dir, tmpName);

  let fh: import('fs/promises').FileHandle | null = null;
  try {
    fh = await fs.open(tmpPath, 'wx', 0o600);
    await fh.writeFile(body, 'utf-8');
    await fh.sync();
  } catch (e) {
    if (fh) await fh.close().catch(() => {});
    await fs.rm(tmpPath, { force: true });
    throw e;
  }
  await fh.close();

  try {
    await fs.rename(tmpPath, targetFile);
  } catch (e) {
    await fs.rm(tmpPath, { force: true });
    throw e;
  }
}

/**
 * 把水位线推进到 next。
 *
 * 幂等:对同一 next 连续调用,主文件字节级相等(JSON.stringify 决定性,
 *      同样的对象 → 同样的字符串)。
 * 原子:tmp + rename,任何中途崩溃主文件保持旧值或新值,不会半写。
 *
 * 不做的事:
 *  - 不校验 next 的字段(由调用方负责 schema)
 *  - 不读旧值比较(next 总是被无条件写入;调用方需要"只在新值更大"语义时自己实现)
 *  - 不并发加锁(见 writeJsonAtomic 注释)
 */
export async function advanceWatermark(
  projectRoot: string,
  next: WatermarkState,
): Promise<WatermarkState> {
  const root = resolveRoot(projectRoot);
  if (root === os.homedir()) {
    throw new WatermarkError(`refuse: projectRoot equals HOME (${root})`);
  }
  const p = watermarkPath(root);

  // JSON.stringify 不接受 undefined 值;遇到 undefined 时归一化为 null,
  // 保证序列化结果确定性 + 可逆。
  const body = JSON.stringify(
    next,
    (_k, val) => (val === undefined ? null : val),
  ) + '\n';

  await writeJsonAtomic(p, body);
  return next;
}