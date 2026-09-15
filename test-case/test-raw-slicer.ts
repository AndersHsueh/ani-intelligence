/**
 * test-case/test-raw-slicer.ts
 *
 * P1 · 收集层 —— 切片器测试
 *
 * 节点判据(任务书):
 *  - 三种匹配规则各至少一个用例(code / decision / manual)
 *  - front-matter 字段完整(kind, sessionId, at, tags, sourceSpan 占位)
 *  - 文件不可变(同内容重复 → 产生新文件,绝不覆盖既有)
 *  - .index.jsonl append-only(行数 == files.length,每行合法 JSON,字段对齐)
 *
 * 运行: bun run test-case/test-raw-slicer.ts
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';

import {
  sliceAndPersist,
  RawSliceError,
  type RawSliceFile,
} from '../src/runtime/workspace/rawSlicer.js';
import { MemoryWikiPathError } from '../src/runtime/workspace/memoryWikiPaths.js';

// ---------- 极简 harness(沿用 P0 风格)----------

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: unknown, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    failures.push(msg);
    console.log(`  ✗ ${msg}`);
  }
}

function section(name: string): void {
  console.log(`\n── ${name} ──`);
}

async function withTmpDir<T>(
  prefix: string,
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// 锁定"现在"以保证 HHMM 可预测
const FIXED_NOW = new Date('2026-09-15T10:30:00.000Z');
const FIXED_ISO = FIXED_NOW.toISOString();

// ---------- 主流程 ----------

async function main(): Promise<void> {
  // ── ① code 块规则 ─────────────────────────────────────────────
  section('① code 规则:围栏块命中并保留内容');
  await withTmpDir('alice-rs-', async (dir) => {
    const text = [
      '随便说一句话。',
      '',
      '```typescript',
      'const x: number = 1;',
      'function foo() { return x + 1; }',
      '```',
      '',
      '上面是一段 TS。',
    ].join('\n');

    const r = await sliceAndPersist(dir, text, {
      sessionId: 'sess-001',
      now: FIXED_NOW,
    });

    const codeFiles = r.files.filter((f) => f.kind === 'code');
    assert(codeFiles.length === 1, `命中 1 个 code 块 (实际 ${codeFiles.length})`);

    const codeFile = codeFiles[0];
    if (codeFile) {
      const body = await fs.readFile(codeFile.absPath, 'utf-8');
      // front-matter 完整
      assert(body.includes('kind: code'), 'front-matter 含 kind: code');
      assert(
        body.includes(`sessionId: 'sess-001'`),
        "front-matter 含 sessionId: 'sess-001'",
      );
      assert(body.includes(`at: ${FIXED_ISO}`), 'front-matter 含 at: <ISO8601>');
      assert(body.includes('tags: []'), 'front-matter 含 tags: []');
      assert(body.includes('sourceSpan:'), 'front-matter 含 sourceSpan 占位');

      // 内容是去围栏的 body,不是含围栏的原样
      assert(
        body.includes('const x: number = 1;'),
        '文件正文含 const x: number = 1;',
      );
      assert(
        body.includes('function foo() { return x + 1; }'),
        '文件正文含 function foo() ...',
      );
      assert(!body.includes('```typescript'), '去围栏后不含 ```typescript');
      assert(!body.includes('```\n'), '去围栏后不含围栏尾巴');
    }

    // .index.jsonl 同步追加
    const idxPath = path.join(dir, '.index.jsonl');
    const idxRaw = await fs.readFile(idxPath, 'utf-8');
    const idxLines = idxRaw.split('\n').filter((l) => l.length > 0);
    assert(
      idxLines.length === r.files.length,
      `.index.jsonl 行数 == files.length (实际 lines=${idxLines.length}, files=${r.files.length})`,
    );
    for (const line of idxLines) {
      const obj = JSON.parse(line);
      assert(
        typeof obj.file === 'string' && typeof obj.kind === 'string' && typeof obj.at === 'string',
        `index line 字段完整: ${line}`,
      );
    }
  });

  // ── ② decision 规则 ───────────────────────────────────────────
  section('② decision 规则:关键词命中整行');
  await withTmpDir('alice-rs-', async (dir) => {
    const text = [
      '今天我们要讨论两件事。',
      '我决定把 watermark 推进改成 tmp+rename。',
      '明天再说另一件。',
      '别做 ls -la 这种泄底。',
      '收尾。',
    ].join('\n');

    const r = await sliceAndPersist(dir, text, {
      sessionId: 'sess-002',
      now: FIXED_NOW,
    });

    const decisionFiles = r.files.filter((f) => f.kind === 'decision');
    assert(
      decisionFiles.length === 2,
      `命中 2 个 decision 行 (实际 ${decisionFiles.length})`,
    );

    const decisionLines = await Promise.all(
      decisionFiles.map((f) => fs.readFile(f.absPath, 'utf-8')),
    );
    const decisionConcat = decisionLines.join('\n');
    assert(
      decisionConcat.includes('我决定把 watermark 推进改成 tmp+rename'),
      'decision 行包含"决定...改成"整行',
    );
    assert(decisionConcat.includes('别做 ls -la 这种泄底'), 'decision 行包含"别做"');

    // "今天我们要讨论两件事。" 没关键词,不应被命中
    const allConcat = (
      await Promise.all(r.files.map((f) => fs.readFile(f.absPath, 'utf-8')))
    ).join('\n');
    assert(
      !allConcat.split('\n').some((l) => l.trim() === '今天我们要讨论两件事。'),
      '非关键词行不被命中',
    );
  });

  // ── ③ manual 规则 ─────────────────────────────────────────────
  section('③ manual 规则:/raw 段到空行或下一个 /raw');
  await withTmpDir('alice-rs-', async (dir) => {
    // 文本设计原则 —— 让"下一个 /raw" 边界清晰:
    // 段 1 → 空行,段 2 → 下一个 /raw,段 3 → 末尾。
    // 不在 line 内部嵌入 /raw,以避免触发额外切段(那是合法行为,但本测试不测)。
    const text = [
      '前面是普通内容。',
      '/raw 第一段:从 /raw 到空行',
      '延续多行',
      '',
      '上面空行之后,普通内容又来了。',
      '/raw 第二段:从 /raw 到下一个 /raw',
      '/raw 第三段:从上一个 /raw 到末尾',
      '一直到文本末尾',
    ].join('\n');

    const r = await sliceAndPersist(dir, text, {
      sessionId: 'sess-003',
      now: FIXED_NOW,
    });

    const manualFiles = r.files.filter((f) => f.kind === 'manual');
    assert(
      manualFiles.length === 3,
      `命中 3 个 manual 段 (实际 ${manualFiles.length})`,
    );

    const manualBodies = await Promise.all(
      manualFiles.map((f) => fs.readFile(f.absPath, 'utf-8')),
    );
    const concat = manualBodies.join('\n--SEP--\n');
    assert(
      concat.includes('第一段:从 /raw 到空行'),
      'manual 段 1 含触发后内容',
    );
    assert(
      concat.includes('延续多行'),
      'manual 段 1 含延续的多行',
    );
    assert(
      concat.includes('第二段:从 /raw 到下一个 /raw'),
      'manual 段 2 命中(直到下一个 /raw)',
    );
    assert(
      concat.includes('第三段:从上一个 /raw 到末尾'),
      'manual 段 3 命中(从上一个 /raw 到末尾)',
    );
    assert(
      concat.includes('一直到文本末尾'),
      'manual 段 3 包含行末内容',
    );

    // /raw 触发器本身不应出现在写盘内容里(去触发器)
    assert(
      !concat.match(/\/raw\s+(第一段|第二段|第三段)/),
      '写盘内容不含 /raw 触发器字面量',
    );
  });

  // ── ④ front-matter 完整性 + tags 数组 ─────────────────────────
  section('④ front-matter 完整 + tags 非空');
  await withTmpDir('alice-rs-', async (dir) => {
    const text = '```ts\nconst z = 1;\n```\n';
    const r = await sliceAndPersist(dir, text, {
      sessionId: 'sess-with-tags',
      tags: ['alice', 'memory-wiki', 'p1'],
      now: FIXED_NOW,
    });
    const body = await fs.readFile(r.files[0].absPath, 'utf-8');
    assert(body.includes("tags: ['alice', 'memory-wiki', 'p1']"), 'tags 数组正确序列化');
    assert(body.includes(`sessionId: 'sess-with-tags'`), 'sessionId 单引号包裹');
    assert(body.includes('sourceSpan:'), 'sourceSpan 占位行存在(可空值)');

    // 验证 front-matter 以 --- 开头,以 --- 结束
    const lines = body.split('\n');
    assert(lines[0] === '---', 'front-matter 起 ---');
    const secondDash = lines.indexOf('---', 1);
    assert(secondDash > 0, 'front-matter 止 --- 存在');
  });

  // ── ⑤ 文件不可变:同输入第二次跑,产生新文件 ──────────────────────
  section('⑤ 文件不可变(同输入重复调用 → 产生新文件)');
  await withTmpDir('alice-rs-', async (dir) => {
    const text = '```py\nprint(1)\n```\n';

    const r1 = await sliceAndPersist(dir, text, {
      sessionId: 'sess-idem',
      now: FIXED_NOW,
    });
    assert(r1.files.length === 1, 'r1 产生 1 个文件');

    // 第二次:同 sessionId + 同 now(同 HHMM、同 content、同 hash)
    // —— 应撞名 → 自动改用 -2.md
    const r2 = await sliceAndPersist(dir, text, {
      sessionId: 'sess-idem',
      now: FIXED_NOW,
    });
    assert(r2.files.length === 1, 'r2 仍产生 1 个文件');
    assert(
      r2.files[0].file !== r1.files[0].file,
      `r2 文件名 != r1 文件名 (${r1.files[0].file} vs ${r2.files[0].file})`,
    );
    assert(
      r2.files[0].file.endsWith('-2.md'),
      `r2 文件名以 -2.md 结尾 (实际 ${r2.files[0].file})`,
    );

    // 两个文件都存在,内容各自独立
    const c1 = await fs.readFile(r1.files[0].absPath, 'utf-8');
    const c2 = await fs.readFile(r2.files[0].absPath, 'utf-8');
    assert(c1.length > 0 && c2.length > 0, 'r1 / r2 文件均存在且非空');

    // 既有 r1 文件不被修改 —— 第二次跑后它的 mtime 应早于 r2
    const s1 = await fs.stat(r1.files[0].absPath);
    const s2 = await fs.stat(r2.files[0].absPath);
    assert(
      s1.mtimeMs <= s2.mtimeMs,
      `r1 mtime <= r2 mtime (${s1.mtimeMs} vs ${s2.mtimeMs})`,
    );

    // .index.jsonl 累加:第一次 1 行,第二次再 1 行
    const idx = await fs.readFile(path.join(dir, '.index.jsonl'), 'utf-8');
    const lines = idx.split('\n').filter((l) => l.length > 0);
    assert(
      lines.length === 2,
      `.index.jsonl 累加到 2 行 (实际 ${lines.length})`,
    );
  });

  // ── ⑥ 文件不可变:三次同输入 → -2/-3.md 不互相覆盖 ─────────────
  section('⑥ 不可变:三次同输入 → -2.md / -3.md 不互相覆盖');
  await withTmpDir('alice-rs-', async (dir) => {
    const text = '```\nhello\n```\n';
    const opts = { sessionId: 'sess-3x', now: FIXED_NOW };
    const r1 = await sliceAndPersist(dir, text, opts);
    const r2 = await sliceAndPersist(dir, text, opts);
    const r3 = await sliceAndPersist(dir, text, opts);

    const allFiles = [r1, r2, r3].flatMap((r) => r.files);
    const names = allFiles.map((f) => f.file);
    const unique = new Set(names);
    assert(
      unique.size === 3,
      `三个文件名互不相同 (${names.join(', ')})`,
    );

    // .raw 目录下确实有三个文件
    const rawDir = path.join(dir, '.raw');
    const entries = await fs.readdir(rawDir);
    assert(entries.length === 3, `.raw/ 下有 3 个文件 (实际 ${entries.length})`);
  });

  // ── ⑦ .index.jsonl 字段对齐 + append-only ─────────────────────
  section('⑦ .index.jsonl:字段对齐 + append-only');
  await withTmpDir('alice-rs-', async (dir) => {
    const text = [
      '```js\nconst a=1;\n```',
      '我们决定走 A 方案。',
      '/raw 关键数据',
      '',
    ].join('\n');

    const r1 = await sliceAndPersist(dir, text, {
      sessionId: 'sess-idx',
      now: FIXED_NOW,
    });
    assert(r1.files.length === 3, `第一次产生 3 个文件 (实际 ${r1.files.length})`);

    const idxPath = path.join(dir, '.index.jsonl');
    const before = await fs.readFile(idxPath, 'utf-8');
    const beforeSize = before.length;

    // 第二次只追加 1 个
    const r2 = await sliceAndPersist(dir, text, {
      sessionId: 'sess-idx',
      now: FIXED_NOW,
    });
    assert(r2.files.length === 3, `第二次产生 3 个文件 (实际 ${r2.files.length})`);

    const after = await fs.readFile(idxPath, 'utf-8');
    assert(
      after.startsWith(before),
      '.index.jsonl 头部保持不变(append-only)',
    );
    assert(
      after.length > beforeSize,
      `.index.jsonl 长度增长 (before=${beforeSize}, after=${after.length})`,
    );

    // 每行 JSON 必须可解析,且字段对齐
    const allLines = after.split('\n').filter((l) => l.length > 0);
    assert(
      allLines.length === 6,
      `index 总行数 = 6 (实际 ${allLines.length})`,
    );
    for (const line of allLines) {
      const obj = JSON.parse(line);
      const f = obj.file;
      const k = obj.kind;
      const at = obj.at;
      assert(
        typeof f === 'string' && /^\d{4}-[a-f0-9]+(-\d+)?\.md$/.test(f),
        `file 形如 HHMM-hash.md 或 HHMM-hash-N.md: ${f}`,
      );
      assert(
        ['code', 'decision', 'manual'].includes(k),
        `kind ∈ {code,decision,manual}: ${k}`,
      );
      assert(at === FIXED_ISO, `at == FIXED_ISO: ${at}`);
    }
  });

  // ── ⑧ HOME 边界:projectRoot = HOME 必须 throw ─────────────────
  section('⑧ HOME 边界:sliceAndPersist(HOME) 必须 throw');
  let threwHome = false;
  try {
    await sliceAndPersist(os.homedir(), '任何内容', { sessionId: 'x' });
  } catch (e) {
    threwHome = e instanceof RawSliceError;
  }
  assert(threwHome, 'HOME 抛 RawSliceError');

  // ── ⑨ 空字符串 / 无 sessionId ─────────────────────────────────
  section('⑨ 输入校验:空 / 无 sessionId');
  let threwEmpty = false;
  try {
    await sliceAndPersist('', 'x', { sessionId: 'x' });
  } catch (e) {
    threwEmpty = e instanceof RawSliceError;
  }
  assert(threwEmpty, '空字符串抛 RawSliceError');

  let threwNoSid = false;
  await withTmpDir('alice-rs-', async (dir) => {
    try {
      await sliceAndPersist(dir, 'x', { sessionId: '' });
    } catch (e) {
      threwNoSid = e instanceof RawSliceError;
    }
    assert(threwNoSid, 'sessionId 空 → 抛 RawSliceError');
  });

  // ── ⑩ NUL 字节 / 非字符串 ──────────────────────────────────────
  section('⑩ NUL 字节');
  let threwNul = false;
  try {
    await sliceAndPersist('/tmp/foo\0bar', 'x', { sessionId: 'x' });
  } catch (e) {
    threwNul = e instanceof RawSliceError;
  }
  assert(threwNul, 'NUL 字节抛 RawSliceError');

  // ── ⑪ 与 P0 联动:确保 .raw 由 P0 模块负责 ─────────────────────
  section('⑪ 与 P0 ensureMemoryWikiDirs 联动');
  await withTmpDir('alice-rs-', async (dir) => {
    // 调用前不存在 .raw
    let existed = true;
    try {
      await fs.stat(path.join(dir, '.raw'));
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err?.code === 'ENOENT') existed = false;
    }
    assert(!existed, '.raw 调用前不存在');

    await sliceAndPersist(dir, '```x\n1\n```\n', { sessionId: 's0', now: FIXED_NOW });

    // 调用后 .raw 存在
    const stat = await fs.stat(path.join(dir, '.raw'));
    assert(stat.isDirectory(), '.raw 调用后存在');

    // 确保 MemoryWikiPathError 从 P0 链路可见(任一处 throw 都应能 catch)
    // 这里只 smoke test:确保 P0 模块能 import,行为不变
    const { ensureMemoryWikiDirs } = await import(
      '../src/runtime/workspace/memoryWikiPaths.js'
    );
    const r = await ensureMemoryWikiDirs(dir);
    assert(
      r.existed.includes('.raw'),
      `ensureMemoryWikiDirs(existed) 含 .raw (实际 ${JSON.stringify(r.existed)})`,
    );
  });

  // ── ⑫ 文本里完全没匹配项 → 0 files,index 仍是空(或不存在) ────
  section('⑫ 零匹配:files=[] 且 index 仍 append-only');
  await withTmpDir('alice-rs-', async (dir) => {
    const r = await sliceAndPersist(dir, '完全普通的话,没有任何规则会命中。', {
      sessionId: 's-zero',
      now: FIXED_NOW,
    });
    assert(r.files.length === 0, '零匹配 files=[]');
    assert(r.indexEntries === 0, '零匹配 indexEntries=0');

    // 但 .index.jsonl 仍被创建(空文件),便于后续追加
    const idxPath = path.join(dir, '.index.jsonl');
    const stat = await fs.stat(idxPath);
    assert(stat.isFile(), '.index.jsonl 已创建');
    assert(stat.size === 0, `.index.jsonl 大小 = 0 (实际 ${stat.size})`);
  });

  // ── ⑬ HHMM 是本地时间,且文件名格式可控 ───────────────────────
  section('⑬ HHMM 用本地时间');
  await withTmpDir('alice-rs-', async (dir) => {
    // 选一个特定本地时间:本地 14:30 → HHMM = "1430"
    const localTime = new Date(2026, 8, 15, 14, 30, 0); // 月份 0-indexed:8=9月
    const r = await sliceAndPersist(dir, '```x\n1\n```\n', {
      sessionId: 's-time',
      now: localTime,
    });
    assert(r.files.length === 1, '产生 1 文件');
    assert(
      /^\d{4}-[a-f0-9]{8}\.md(-\d+\.md)?$/.test(r.files[0].file),
      `文件名形如 HHMM-hash.md: ${r.files[0].file}`,
    );
    assert(
      r.files[0].file.startsWith('1430-'),
      `本地 14:30 → HHMM="1430" (实际 ${r.files[0].file})`,
    );
  });

  // ── 总结 ──
  console.log(`\n── 总结 ──`);
  console.log(`  passed: ${passed}`);
  console.log(`  failed: ${failed}`);
  if (failed > 0) {
    console.log(`\n失败明细:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  } else {
    console.log(`  ✓ all green`);
  }
}

main().catch((e) => {
  console.error('test crashed:', e);
  process.exit(1);
});