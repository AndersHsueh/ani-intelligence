/**
 * test-case/test-watermark.ts
 *
 * P1 · 收集层 —— 水位线推进器测试
 *
 * 节点判据(任务书):
 *  - 首次创建
 *  - 幂等推进(同一 next 两次 → 主文件字节级相等)
 *  - 原子性(tmp + rename)
 *  - 崩溃恢复模拟(写 tmp 后不 rename → 主文件仍是旧值)
 *
 * 配套边界:
 *  - 不存在 → null
 *  - HOME / 空 / NUL throw
 *  - 坏 JSON throw
 *  - tmp 文件不会被读到(读主文件)
 *
 * 运行: bun run test-case/test-watermark.ts
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

import {
  readWatermark,
  advanceWatermark,
  writeJsonAtomic,
  WatermarkError,
} from '../src/runtime/workspace/watermark.js';
import {
  makeCounters,
  makeAssert,
  makeSection,
  makeWithTmpDir,
  summarize,
  withHomeSentinel,
} from './_harness.js';

// ---------- 极简 harness(共享自 test-case/_harness.ts)----------

const counters = makeCounters();
const assert = makeAssert(counters);
const section = makeSection();
const withTmpDir = makeWithTmpDir();

async function readWatermarkBytes(projectRoot: string): Promise<Buffer> {
  return await fs.readFile(path.join(projectRoot, '.watermark.json'));
}

async function listTmpFiles(projectRoot: string): Promise<string[]> {
  const entries = await fs.readdir(projectRoot);
  return entries.filter((n) => n.startsWith('.watermark.json.tmp-'));
}

// ---------- 主流程 ----------

async function main(): Promise<void> {
  // ── ① 首次创建 ────────────────────────────────────────────────
  section('① 首次创建 + readWatermark 返回新值');
  await withTmpDir('alice-wm-', async (dir) => {
    assert(
      (await readWatermark(dir)) === null,
      '首次创建前 readWatermark 返回 null',
    );

    const v1 = { cursor: 1, at: '2026-09-15T10:30:00.000Z' };
    const returned = await advanceWatermark(dir, v1);
    assert(returned === v1, 'advanceWatermark 返回 next 引用');

    const got = await readWatermark(dir);
    assert(
      got !== null && got.cursor === 1 && got.at === v1.at,
      `readWatermark 返回 v1 (实际 ${JSON.stringify(got)})`,
    );

    // 主文件存在 + 不是 tmp
    const stat = await fs.stat(path.join(dir, '.watermark.json'));
    assert(stat.isFile(), '.watermark.json 是文件');

    // 推进后,目录下不应有 .watermark.json.tmp-* 残留
    const tmps = await listTmpFiles(dir);
    assert(tmps.length === 0, `无 tmp 残留 (实际 ${tmps.length})`);
  });

  // ── ② 幂等推进:同 next 两次 → 字节级相等 ───────────────────────
  section('② 幂等推进(同 next 两次调用 → 主文件字节级相等)');
  await withTmpDir('alice-wm-', async (dir) => {
    const v = { cursor: 42, label: 'P1-raw-slicer-watermark' };
    await advanceWatermark(dir, v);
    const before = await readWatermarkBytes(dir);

    await advanceWatermark(dir, v);
    const after = await readWatermarkBytes(dir);

    assert(
      before.equals(after),
      `主文件字节级相等 (before.len=${before.length}, after.len=${after.length})`,
    );

    // 第三次推进成不同值,主文件确实更新了
    const v2 = { cursor: 43, label: 'changed' };
    await advanceWatermark(dir, v2);
    const afterChange = await readWatermarkBytes(dir);
    assert(
      !afterChange.equals(before),
      '不同 next → 主文件确实改变',
    );
    const parsed = JSON.parse(afterChange.toString('utf-8'));
    assert(parsed.cursor === 43, `cursor 推进到 43 (实际 ${parsed.cursor})`);
  });

  // ── ③ 原子性:writeJsonAtomic(tmp + rename) 行为可观察 ─────────
  section('③ 原子性:writeJsonAtomic 走 tmp + rename');
  await withTmpDir('alice-wm-', async (dir) => {
    const target = path.join(dir, '.watermark.json');

    // 第一次:target 不存在 → 仍能写
    await writeJsonAtomic(target, '{"v":1}\n');
    assert(fsSync.existsSync(target), '第一次写后 target 存在');

    // 第二次:target 已存在 → 覆盖成功
    await writeJsonAtomic(target, '{"v":2}\n');
    const got = JSON.parse(await fs.readFile(target, 'utf-8'));
    assert(got.v === 2, `第二次写覆盖 (实际 ${JSON.stringify(got)})`);

    // 写完无 tmp 残留
    const tmps = await listTmpFiles(dir);
    assert(tmps.length === 0, `原子写后无 tmp 残留 (实际 ${tmps.length})`);
  });

  // ── ④ 崩溃恢复:模拟"写 tmp 后没 rename" → 读主文件是旧值 ───────
  section('④ 崩溃恢复:tmp 残留不污染主文件');
  await withTmpDir('alice-wm-', async (dir) => {
    // 设置主文件为 v1
    await advanceWatermark(dir, { v: 1 });
    const oldBytes = await readWatermarkBytes(dir);

    // 模拟上轮崩溃留下的 tmp(没 rename)
    const fakeTmpName = `.watermark.json.tmp-${crypto
      .randomBytes(4)
      .toString('hex')}`;
    const fakeTmp = path.join(dir, fakeTmpName);
    await fs.writeFile(fakeTmp, '{"v": "should-not-be-seen"}', 'utf-8');
    assert(fsSync.existsSync(fakeTmp), '伪造的 tmp 文件存在');

    // 读主文件应仍是旧值
    const got = await readWatermark(dir);
    assert(
      got !== null && got.v === 1,
      `读主文件仍是 v1 (实际 ${JSON.stringify(got)})`,
    );

    // 推进到 v2:此时主文件应是 v2,tmp 残留对结果无影响
    await advanceWatermark(dir, { v: 2 });
    const got2 = await readWatermark(dir);
    assert(
      got2 !== null && got2.v === 2,
      `推进后主文件 = v2 (实际 ${JSON.stringify(got2)})`,
    );
    const newBytes = await readWatermarkBytes(dir);
    assert(
      !newBytes.equals(oldBytes),
      '主文件内容确实从 v1 变到 v2',
    );

    // 注:伪造的 tmp 不会被 advanceWatermark 清理 —— 这是有意为之:
    //   本模块不做 tmp 扫描 / GC(任务书未要求,且 GC 越界)。
    //   只保证:tmp 残留时,主文件读写正常,推进正常。
  });

  // ── ⑤ HOME 边界 ───────────────────────────────────────────────
  section('⑤ HOME 边界');
  let threwHomeRead = false;
  try {
    await readWatermark(os.homedir());
  } catch (e) {
    threwHomeRead = e instanceof WatermarkError;
  }
  assert(threwHomeRead, 'readWatermark(HOME) → throw');

  let threwHomeAdv = false;
  try {
    await advanceWatermark(os.homedir(), { v: 1 });
  } catch (e) {
    threwHomeAdv = e instanceof WatermarkError;
  }
  assert(threwHomeAdv, 'advanceWatermark(HOME) → throw');

  // ── ⑥ 空 / NUL ────────────────────────────────────────────────
  section('⑥ 输入校验:空字符串 / NUL');
  let threwEmpty = false;
  try {
    await readWatermark('');
  } catch (e) {
    threwEmpty = e instanceof WatermarkError;
  }
  assert(threwEmpty, 'readWatermark("") → throw');

  let threwNul = false;
  try {
    await readWatermark('/tmp/foo\0bar');
  } catch (e) {
    threwNul = e instanceof WatermarkError;
  }
  assert(threwNul, 'readWatermark(NUL) → throw');

  // ── ⑦ 坏 JSON ──────────────────────────────────────────────────
  section('⑦ 坏 JSON 文件 → throw');
  await withTmpDir('alice-wm-', async (dir) => {
    const p = path.join(dir, '.watermark.json');
    await fs.writeFile(p, '{not valid json', 'utf-8');
    let threw = false;
    let msg = '';
    try {
      await readWatermark(dir);
    } catch (e) {
      threw = e instanceof WatermarkError;
      msg = (e as Error).message;
    }
    assert(
      threw && /corrupt/i.test(msg),
      `坏 JSON 抛 WatermarkError 且消息含 corrupt (msg=${msg})`,
    );
  });

  // ── ⑧ next 中 undefined 字段归一化为 null(序列化确定性) ────────
  section('⑧ undefined 值归一化为 null');
  await withTmpDir('alice-wm-', async (dir) => {
    const v = { a: 1, b: undefined, c: 'x' } as Record<string, unknown>;
    await advanceWatermark(dir, v);
    const got = await readWatermark(dir);
    assert(
      got !== null && got.a === 1 && got.b === null && got.c === 'x',
      `undefined → null (实际 ${JSON.stringify(got)})`,
    );
  });

  // ── ⑨ 跨次推进:cursor 自增 → 主文件更新,可读回 ───────────────
  section('⑨ 连续推进 + 读回');
  await withTmpDir('alice-wm-', async (dir) => {
    for (let i = 1; i <= 5; i++) {
      await advanceWatermark(dir, { cursor: i });
    }
    const got = await readWatermark(dir);
    assert(
      got !== null && got.cursor === 5,
      `5 次推进后 cursor=5 (实际 ${JSON.stringify(got)})`,
    );

    // tmp 仍无残留
    const tmps = await listTmpFiles(dir);
    assert(tmps.length === 0, `5 次推进后无 tmp 残留 (实际 ${tmps.length})`);
  });

  // ── ⑩ HOME 下任何路径不被写入(哨兵文件对比) ───────────────────
  section('⑩ HOME 下任何路径不被写入');
  await withHomeSentinel('.alice-wm-test-sentinel-', async () => {
    await withTmpDir('alice-wm-', async (dir) => {
      await advanceWatermark(dir, { x: 1 });
      await readWatermark(dir);
    });
  });
  assert(true, 'HOME 下任何路径不被写入(withHomeSentinel 通过)');

  // ── 总结 ──
  summarize(counters);
}

main().catch((e) => {
  console.error('test crashed:', e);
  process.exit(1);
});