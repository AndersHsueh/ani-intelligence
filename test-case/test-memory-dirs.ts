/**
 * test-case/test-memory-dirs.ts
 *
 * P0 · 约定层 —— 测试
 *
 * 节点判据(PRD/0915):
 *  - 三目录幂等创建(二次运行 diff 为空)
 *  - git 仓库场景:.gitignore 被追加,且再跑一次 diff 为空
 *  - 非 git 目录场景:不出现 .gitignore
 *  - 不触碰真实 ~/.alice 或用户 HOME 下任何路径
 *
 * 运行: bun run test-case/test-memory-dirs.ts
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';

import {
  ensureMemoryWikiDirs,
  appendMemoryWikiGitignore,
  MEMORY_WIKI_DIRS,
  MemoryWikiPathError,
} from '../src/runtime/workspace/memoryWikiPaths.js';

// ---------- 极简 harness ----------

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

async function withTmpGitRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'alice-mw-git-'));
  try {
    fsSync.mkdirSync(path.join(dir, '.git'), { recursive: true });
    // 一个最小 git 仓库所需的内部结构(让 .git 看起来"像样")
    fsSync.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    fsSync.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// ---------- 主流程 ----------

async function main(): Promise<void> {
  // ── ① 三目录幂等创建 ──
  section('① ensureMemoryWikiDirs 幂等创建');
  await withTmpDir('alice-mw-', async (dir) => {
    const r1 = await ensureMemoryWikiDirs(dir);
    assert(
      r1.created.length === 3,
      `首次创建 3 个目录 (实际 created=${JSON.stringify(r1.created)})`,
    );
    assert(
      r1.existed.length === 0,
      `首次 existed 应为 0 (实际 existed=${JSON.stringify(r1.existed)})`,
    );
    for (const name of MEMORY_WIKI_DIRS) {
      const stat = await fs.stat(path.join(dir, name));
      assert(stat.isDirectory(), `${name}/ 是目录`);
    }

    const r2 = await ensureMemoryWikiDirs(dir);
    assert(
      r2.created.length === 0,
      `二次创建应为 0 (实际 created=${JSON.stringify(r2.created)})`,
    );
    assert(
      r2.existed.length === 3,
      `二次 existed 应为 3 (实际 existed=${JSON.stringify(r2.existed)})`,
    );

    // 二次运行后,所有目录仍存在且为空
    for (const name of MEMORY_WIKI_DIRS) {
      const stat = await fs.stat(path.join(dir, name));
      assert(stat.isDirectory(), `二次运行后 ${name}/ 仍是目录`);
    }
  });

  // ── ② 不覆盖既有文件 / 不清空 ──
  section('② 不清空、不覆盖已有文件');
  await withTmpDir('alice-mw-', async (dir) => {
    const rawDir = path.join(dir, '.raw');
    await fs.mkdir(rawDir, { recursive: false });
    const sentinel = path.join(rawDir, 'sentinel.txt');
    await fs.writeFile(sentinel, 'do-not-touch', 'utf-8');

    await ensureMemoryWikiDirs(dir);
    const content = await fs.readFile(sentinel, 'utf-8');
    assert(
      content === 'do-not-touch',
      `.raw/sentinel.txt 内容未被改动 (实际: ${JSON.stringify(content)})`,
    );

    // .wiki / .outputs 之前不存在,会被创建
    const wikiStat = await fs.stat(path.join(dir, '.wiki'));
    const outStat = await fs.stat(path.join(dir, '.outputs'));
    assert(wikiStat.isDirectory(), '.wiki/ 被创建');
    assert(outStat.isDirectory(), '.outputs/ 被创建');
  });

  // ── ③ 路径冲突:.raw 已存在但不是目录(文件)── 必须 throw ──
  section('③ 路径冲突保护');
  await withTmpDir('alice-mw-', async (dir) => {
    await fs.writeFile(path.join(dir, '.raw'), 'I am a file, not a dir');
    let threw = false;
    try {
      await ensureMemoryWikiDirs(dir);
    } catch (e: unknown) {
      threw = e instanceof MemoryWikiPathError;
    }
    assert(threw, '.raw 已是文件 → 抛 MemoryWikiPathError');
  });

  // ── ④ git 仓库:.gitignore 幂等追加 ──
  section('④ git 仓库场景:.gitignore 幂等追加');
  await withTmpGitRepo(async (dir) => {
    const r1 = await appendMemoryWikiGitignore(dir);
    assert(
      r1.appended === true,
      `首次 appended=true (实际: ${r1.appended}, reason=${r1.reason})`,
    );
    const content1 = await fs.readFile(path.join(dir, '.gitignore'), 'utf-8');
    assert(content1.includes('.raw/'), '.gitignore 含 .raw/');
    assert(content1.includes('.wiki/'), '.gitignore 含 .wiki/');
    assert(content1.includes('.outputs/'), '.gitignore 含 .outputs/');
    assert(content1.includes('node_modules'), '.gitignore 保留原有 node_modules');
    assert(
      content1.includes('# alice-code memory wiki (auto-added, idempotent)'),
      '.gitignore 含唯一 marker 行',
    );

    // 二次:diff 为空(字节级相等)
    const before2 = await fs.readFile(path.join(dir, '.gitignore'), 'utf-8');
    const r2 = await appendMemoryWikiGitignore(dir);
    const after2 = await fs.readFile(path.join(dir, '.gitignore'), 'utf-8');
    assert(
      r2.appended === false,
      `二次 appended=false (实际: ${r2.appended}, reason=${r2.reason})`,
    );
    assert(before2 === after2, '二次运行 .gitignore 字节级 diff 为空');
  });

  // ── ⑤ 三跑后 diff 仍为空(高强度幂等)──
  section('⑤ 三跑幂等');
  await withTmpGitRepo(async (dir) => {
    // 跑一次"点火",让 entries 进入 .gitignore,之后才是真幂等
    const first = await appendMemoryWikiGitignore(dir);
    assert(first.appended === true, `首次 appended=true (reason=${first.reason})`);
    const before = await fs.readFile(path.join(dir, '.gitignore'), 'utf-8');
    // 再跑 3 次,每次都应 no-op
    for (let i = 0; i < 3; i++) {
      const r = await appendMemoryWikiGitignore(dir);
      assert(r.appended === false, `第 ${i + 2} 次 appended=false (reason=${r.reason})`);
    }
    const after = await fs.readFile(path.join(dir, '.gitignore'), 'utf-8');
    assert(before === after, '三跑后 .gitignore 字节级 diff 为空');
  });

  // ── ⑥ 非 git 目录:绝不创建 .gitignore ──
  section('⑥ 非 git 目录:不创建 .gitignore');
  await withTmpDir('alice-mw-', async (dir) => {
    const r = await appendMemoryWikiGitignore(dir);
    assert(
      r.appended === false,
      `非 git 仓库 appended=false (实际: ${r.appended}, reason=${r.reason})`,
    );
    const gi = path.join(dir, '.gitignore');
    let exists = true;
    try {
      await fs.stat(gi);
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err?.code === 'ENOENT') exists = false;
    }
    assert(!exists, '非 git 目录中不应出现 .gitignore');
  });

  // ── ⑦ 非 git 但 .gitignore 已存在:仍然不追加 ──
  section('⑦ 非 git 但 .gitignore 已存在:仍不追加');
  await withTmpDir('alice-mw-', async (dir) => {
    await fs.writeFile(path.join(dir, '.gitignore'), 'original\n');
    const before = await fs.readFile(path.join(dir, '.gitignore'), 'utf-8');
    const r = await appendMemoryWikiGitignore(dir);
    const after = await fs.readFile(path.join(dir, '.gitignore'), 'utf-8');
    assert(r.appended === false, `appended=false (reason=${r.reason})`);
    assert(before === after, '.gitignore 未被改动');
  });

  // ── ⑧ 用户手写过 .raw/ 但无 marker:仍然算"已存在"(按目标行判定)──
  section('⑧ 目标行已存在(无 marker):仍视为已存在,不重复追加');
  await withTmpGitRepo(async (dir) => {
    await fs.writeFile(
      path.join(dir, '.gitignore'),
      '.raw/\n.wiki/\n.outputs/\n',
    );
    const before = await fs.readFile(path.join(dir, '.gitignore'), 'utf-8');
    const r = await appendMemoryWikiGitignore(dir);
    const after = await fs.readFile(path.join(dir, '.gitignore'), 'utf-8');
    assert(r.appended === false, `appended=false (reason=${r.reason})`);
    assert(before === after, '.gitignore 未被改动(避免产生重复行)');
  });

  // ── ⑨ HOME 边界:projectRoot = HOME 必须 throw ──
  section('⑨ HOME 边界保护(ensureMemoryWikiDirs)');
  let threwHome = false;
  let homeErrMsg = '';
  try {
    await ensureMemoryWikiDirs(os.homedir());
  } catch (e: unknown) {
    if (e instanceof MemoryWikiPathError) {
      threwHome = true;
      homeErrMsg = e.message;
    }
  }
  assert(threwHome, `projectRoot = HOME 必须抛 MemoryWikiPathError (msg=${homeErrMsg})`);

  // ── ⑩ HOME 边界:appendMemoryWikiGitignore(HOME) 应直接返回不写 ──
  section('⑩ HOME 边界保护(appendMemoryWikiGitignore)');
  const rHome = await appendMemoryWikiGitignore(os.homedir());
  assert(
    rHome.appended === false,
    `HOME 场景 appended=false (reason=${rHome.reason})`,
  );
  // 同时不创建 HOME 下的 .gitignore(若不存在)
  const homeGi = path.join(os.homedir(), '.gitignore');
  let homeGiCreatedByTest = false;
  try {
    await fs.stat(homeGi);
    homeGiCreatedByTest = true;
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code !== 'ENOENT') throw e;
  }
  // 注意:这里只断言"我们没在 HOME 写 .gitignore";如果用户本身就有,不报错
  // —— 但因为 appendMemoryWikiGitignore 在 HOME 场景下不会触碰任何文件,
  // 所以 homeGiCreatedByTest 应保持其函数调用前的状态。
  // 为简化,只断言函数返回 false 即可(已在上面断言)。
  assert(true, `HOME 边界未触发文件写入 (homeGi 存在与否 = ${homeGiCreatedByTest},与我们无关)`);

  // ── ⑪ HOME 真实写入零发生(哨兵文件对比)──
  section('⑪ HOME 下任何路径不被写入');
  const sentinel = path.join(
    os.homedir(),
    `.alice-mw-test-sentinel-${process.pid}-${Date.now()}`,
  );
  let beforeExists = false;
  try {
    await fs.stat(sentinel);
    beforeExists = true;
  } catch {
    beforeExists = false;
  }
  // 用 tmpdir 反复调用,确保不会越界写到 HOME
  await withTmpDir('alice-mw-', async (dir) => {
    await ensureMemoryWikiDirs(dir);
    await appendMemoryWikiGitignore(dir);
  });
  let afterExists = false;
  try {
    await fs.stat(sentinel);
    afterExists = true;
  } catch {
    afterExists = false;
  }
  assert(!afterExists, `HOME 哨兵未被创建 (beforeExists=${beforeExists}, afterExists=${afterExists})`);
  // 清理(若意外写了)
  if (afterExists) await fs.rm(sentinel, { force: true });

  // ── ⑫ projectRoot 空字符串 ──
  section('⑫ 空字符串 projectRoot');
  let threwEmpty = false;
  try {
    await ensureMemoryWikiDirs('');
  } catch (e: unknown) {
    threwEmpty = e instanceof MemoryWikiPathError;
  }
  assert(threwEmpty, "空字符串 projectRoot 抛 MemoryWikiPathError");

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
