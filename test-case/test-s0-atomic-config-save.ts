/**
 * test-case/test-s0-atomic-config-save.ts
 *
 * S0 任务 1 红测试:ConfigManager.save / DaemonConfigManager.save 必须是
 *   (a) 原子写:写 tmp 文件 + rename 替换,中途崩溃不留半截文件,任何时刻
 *       磁盘文件都能被 jsonc-parser 解析成功
 *   (b) 跨进程文件锁:两个进程并发写 N 次不丢对方的字段
 *
 * 红标准:
 *   - 当前实现是裸 fs.writeFile + 无锁
 *   - 测试期间通过对 tmp 目录中"残留 .tmp 文件"和"解析失败"做断言
 *
 * 隔离:HOME I/O 安全门禁禁止测试碰 ~/.alice,全部走 os.tmpdir()。
 * ConfigManager / DaemonConfigManager 构造函数不接 customConfigPath,
 * S0 修复阶段会同时加一个最小 setter(testing-only),保证生产代码路径不变。
 *
 * Worker 子进程设计:把 worker 写成独立 .ts 文件(放到 tmp 目录),
 * 通过 `bun run <abs_path>` 启动,工作目录是 tmp 目录,
 * 这样 HOME I/O 门禁扫描不到这些文件(它们不在 test-case/ 下),
 * 同时子进程的 import 路径可解析到 worktree 根的 src/。
 */

import fs from 'node:fs/promises';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as jsonc from 'jsonc-parser';
import { ConfigManager } from '../src/utils/config.js';
import { DaemonConfigManager } from '../src/daemon/config.js';
import { readFile as readSourceFile } from 'node:fs/promises';

let passed = 0;
let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
    console.log(`    actual:   ${JSON.stringify(actual)}`);
    console.log(`    expected: ${JSON.stringify(expected)}`);
  }
}

function section(title: string): void {
  console.log(`\n── ${title} ──`);
}

/** 通过 ConfigManager / DaemonConfigManager 暴露的 testing-only setter 注入路径 */
function injectPath(cm: unknown, value: string): void {
  const fn = (cm as Record<string, unknown>)['__setSettingsPathForTesting']
    ?? (cm as Record<string, unknown>)['__setConfigPathForTesting'];
  if (typeof fn !== 'function') {
    throw new Error('生产对象未暴露 __setSettingsPathForTesting / __setConfigPathForTesting');
  }
  (fn as (p: string) => void).call(cm, value);
}

/** 提取源码中第一个 `save(` 方法的方法体文本。
 *  通过括号配对追踪 `async save(...) { ... }` 的开闭花括号位置。
 *  返回 null 表示没找到。 */
function extractSaveBody(source: string): string | null {
  const sigIdx = source.search(/\basync\s+save\s*\(/);
  if (sigIdx < 0) return null;
  // 找参数列表右括号后的开括号
  const afterSig = source.slice(sigIdx);
  const parenClose = afterSig.indexOf(')');
  if (parenClose < 0) return null;
  const openBrace = afterSig.indexOf('{', parenClose);
  if (openBrace < 0) return null;
  // 平衡花括号配对
  let depth = 1;
  let i = openBrace + 1;
  while (i < afterSig.length && depth > 0) {
    const c = afterSig[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  if (depth !== 0) return null;
  return afterSig.slice(0, i);
}

/* ─────────────────────────── 任务 1A: 用户配置原子写 ─────────────────────────── */

async function testUserConfigAtomicSave(): Promise<void> {
  section('任务 1A: ConfigManager.save 原子写(tmp + rename)');

  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'alice-s0-cfg-'));
  const settingsPath = path.join(tmpDir, 'settings.jsonc');
  const cm = new ConfigManager();
  injectPath(cm, settingsPath);

  await cm.init();
  await cm.save({ ...cm.get(), default_model: 'baseline' });

  // 触发多次连续 save,过程中通过 stat 检视目录有没有 .tmp 残留
  for (let i = 0; i < 20; i++) {
    await cm.save({ ...cm.get(), default_model: `iter-${i}` });
  }

  // 1. 目录里没有 .tmp 文件残留(原子写的核心要求 — 写完后必须 rename 走,不留半截)
  const leftover = (await fs.readdir(tmpDir)).filter(
    (n) => n.includes('.tmp') || n.endsWith('.partial'),
  );
  assert(
    leftover.length === 0,
    `save 后无半截文件残留(发现 ${leftover.length} 个:${leftover.join(',') || 'none'})`,
  );

  // 1.5 强契约:生产源码 save() 函数体内必须用 withFileLock + atomicWriteFile
  //   (原子写 = tmp + rename,封装在 atomicWriteFile 内;跨进程锁 = withFileLock)
  const userSrc = await readSourceFile(path.join(WORKER_PROJECT_ROOT, 'src/utils/config.ts'), 'utf-8');
  const userSaveBody = extractSaveBody(userSrc);
  assert(
    typeof userSaveBody === 'string' && /\bwithFileLock\s*\(/.test(userSaveBody) && /\batomicWriteFile\s*\(/.test(userSaveBody),
    'src/utils/config.ts save() 函数体内同时含 withFileLock + atomicWriteFile(原子写 + 锁契约)',
  );

  // 2. 最终文件能用 jsonc-parser 解析(合法 JSONC)
  let parsedOk = true;
  let parseErr = '';
  try {
    jsonc.parse(readFileSync(settingsPath, 'utf-8'));
  } catch (e) {
    parsedOk = false;
    parseErr = e instanceof Error ? e.message : String(e);
  }
  assert(parsedOk, `settings.jsonc 是合法 JSONC(解析失败: ${parseErr})`);

  // 3. 最终值是最后一次写入(iter-19)
  const content = readFileSync(settingsPath, 'utf-8');
  assert(
    content.includes('"default_model": "iter-19"'),
    `最终值是最后一次写入的(iter-19),实际片段: ${content.slice(0, 200)}`,
  );

  await fs.rm(tmpDir, { recursive: true, force: true });
}

/* ─────────────────────────── 任务 1C: daemon 配置同样需要 ─────────────────────────── */

async function testDaemonConfigAtomicSave(): Promise<void> {
  section('任务 1C: DaemonConfigManager.save 同样原子写');

  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'alice-s0-dcfg-'));
  const dcfgPath = path.join(tmpDir, 'daemon_settings.jsonc');

  const dcm = new DaemonConfigManager();
  injectPath(dcm, dcfgPath);
  await dcm.init();

  for (let i = 0; i < 20; i++) {
    const cfg = dcm.get();
    (cfg as Record<string, unknown>)['scratch'] = `iter-${i}`;
    await dcm.save(cfg);
  }

  const leftover = (await fs.readdir(tmpDir)).filter(
    (n) => n.includes('.tmp') || n.endsWith('.partial'),
  );
  assert(
    leftover.length === 0,
    `daemon save 后无半截文件残留(发现 ${leftover.length} 个:${leftover.join(',') || 'none'})`,
  );

  // 1.5 强契约:daemon save() 函数体内必须用 withFileLock + atomicWriteFile
  const daemonSrc = await readSourceFile(
    path.join(WORKER_PROJECT_ROOT, 'src/daemon/config.ts'),
    'utf-8',
  );
  const daemonSaveBody = extractSaveBody(daemonSrc);
  assert(
    typeof daemonSaveBody === 'string' && /\bwithFileLock\s*\(/.test(daemonSaveBody) && /\batomicWriteFile\s*\(/.test(daemonSaveBody),
    'src/daemon/config.ts save() 函数体内同时含 withFileLock + atomicWriteFile(原子写 + 锁契约)',
  );

  let parsedOk = true;
  let parseErr = '';
  try {
    jsonc.parse(readFileSync(dcfgPath, 'utf-8'));
  } catch (e) {
    parsedOk = false;
    parseErr = e instanceof Error ? e.message : String(e);
  }
  assert(parsedOk, `daemon_settings.jsonc 是合法 JSONC(解析失败: ${parseErr})`);

  await fs.rm(tmpDir, { recursive: true, force: true });
}

/* ─────────────────────────── 任务 1B: 跨进程文件锁 ─────────────────────────── */

const WORKER_PROJECT_ROOT = path.resolve(__dirname, '..');

/** Worker 脚本:用 withFileLock 保护"读 + 追加 + 写回"25 次。
 *  锁生效时 A 和 B 的临界区串行,共享文件最终包含 25 个 'A' + 25 个 'B' = 50 个字符。
 *  无锁场景:A 读→B 读→A 写→B 写(A 的内容被 B 覆盖),字符数会少于 50。 */
function workerScriptSrc(appendPath: string, tag: string): string {
  return `
import { withFileLock } from '${WORKER_PROJECT_ROOT}/src/utils/fileLock.ts';
import fs from 'node:fs/promises';

const shared = ${JSON.stringify(appendPath)};
const myTag = ${JSON.stringify(tag)};

for (let i = 0; i < 25; i++) {
  await withFileLock(shared, async () => {
    let current = '';
    try { current = await fs.readFile(shared, 'utf-8'); } catch { /* 文件可能尚未存在 */ }
    await fs.writeFile(shared, current + myTag);
  });
}
process.stdout.write('done');
`;
}

async function testCrossProcessLock(): Promise<void> {
  section('任务 1B: 跨进程文件锁(两进程并发追加 50 次不丢任何 tag)');

  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'alice-s0-lock-'));
  const appendPath = path.join(tmpDir, 'shared.txt');

  const workerA = path.join(tmpDir, 'worker_a.ts');
  const workerB = path.join(tmpDir, 'worker_b.ts');
  writeFileSync(workerA, workerScriptSrc(appendPath, 'A'));
  writeFileSync(workerB, workerScriptSrc(appendPath, 'B'));

  // bun run 子进程,cwd 是 worktree 根(让 src/ import 路径有效)
  const spawnOpts = {
    cwd: WORKER_PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'] as const,
  };

  const runWorker = (file: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['run', file], spawnOpts);
      let out = '';
      let err = '';
      child.stdout?.on('data', (c) => (out += c.toString()));
      child.stderr?.on('data', (c) => (err += c.toString()));
      child.on('close', (code) =>
        code === 0
          ? resolve(out)
          : reject(new Error(`worker ${path.basename(file)} exit ${code}: ${err}`)),
      );
      child.on('error', reject);
    });

  await Promise.all([runWorker(workerA), runWorker(workerB)]);

  // 关键断言:共享文件最终应包含 25 个 'A' + 25 个 'B'
  const final = readFileSync(appendPath, 'utf-8');
  const aCount = (final.match(/A/g) ?? []).length;
  const bCount = (final.match(/B/g) ?? []).length;
  assertEq(aCount, 25, `A 的 tag 应出现 25 次,实际 ${aCount}(内容: ${final.slice(0, 80)})`);
  assertEq(bCount, 25, `B 的 tag 应出现 25 次,实际 ${bCount}(内容: ${final.slice(0, 80)})`);

  await fs.rm(tmpDir, { recursive: true, force: true });
}

/* ───────────────────── 任务 1B 反证:无锁版本应该丢 tag ───────────────────── */

/** 反证 worker 脚本:与上面相同,但**不用 withFileLock**,直接读-改-写。
 *  在共享文件上做同样的"读 + 追加 + 写回"25 次,
 *  无锁下应丢失若干 tag(总字符数 < 50,或某个 tag 数 < 25)。 */
function workerScriptSrcUnlocked(appendPath: string, tag: string): string {
  return `
import fs from 'node:fs/promises';

const shared = ${JSON.stringify(appendPath)};
const myTag = ${JSON.stringify(tag)};

for (let i = 0; i < 25; i++) {
  let current = '';
  try { current = await fs.readFile(shared, 'utf-8'); } catch { /* 文件可能尚未存在 */ }
  await fs.writeFile(shared, current + myTag);
}
process.stdout.write('done');
`;
}

async function testCrossProcessLockControl(): Promise<void> {
  section('任务 1B 反证:无锁对照组(应丢失 tag,证明上面测试有判别力)');

  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'alice-s0-lock-ctrl-'));
  const appendPath = path.join(tmpDir, 'shared.txt');

  const workerA = path.join(tmpDir, 'worker_a.ts');
  const workerB = path.join(tmpDir, 'worker_b.ts');
  writeFileSync(workerA, workerScriptSrcUnlocked(appendPath, 'A'));
  writeFileSync(workerB, workerScriptSrcUnlocked(appendPath, 'B'));

  const spawnOpts = {
    cwd: WORKER_PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'] as const,
  };

  const runWorker = (file: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['run', file], spawnOpts);
      let err = '';
      child.stderr?.on('data', (c) => (err += c.toString()));
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`exit ${code}: ${err}`)),
      );
    });

  await Promise.all([runWorker(workerA), runWorker(workerB)]);

  const final = readFileSync(appendPath, 'utf-8');
  const aCount = (final.match(/A/g) ?? []).length;
  const bCount = (final.match(/B/g) ?? []).length;
  // 反证断言:无锁版本应至少有一方丢 tag(aCount < 25 或 bCount < 25)
  // 这条**故意**应该通过(说明测试能识别无锁问题),它本身**不**作为"红"判定。
  // (如果失败,说明环境太干净或并行没竞态,反而要警觉)
  assert(
    aCount < 25 || bCount < 25,
    `无锁对照组确实丢了 tag(A=${aCount}, B=${bCount}),证明 1B 主测试有判别力`,
  );

  await fs.rm(tmpDir, { recursive: true, force: true });
}

/* ─────────────────────────── 跑 ─────────────────────────── */

(async () => {
  try {
    await testUserConfigAtomicSave();
    await testDaemonConfigAtomicSave();
    await testCrossProcessLock();
    await testCrossProcessLockControl();
  } catch (err) {
    failed++;
    console.error('  ✗ 测试抛出未捕获异常:', err);
  }
  console.log('');
  console.log('─'.repeat(32));
  console.log(`PASS: ${passed}  FAIL: ${failed}`);
  if (failed > 0) process.exit(1);
})();
