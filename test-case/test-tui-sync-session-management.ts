/**
 * test-case/test-tui-sync-session-management.ts
 *
 * TUI 融合 W13/W5/W6：daemon 会话管理端点 —— core 层 SessionManager 先红测试
 *
 * 测试文件：test-case/test-tui-sync-session-management.ts（本文件）
 * 实现目标（工程师照此契约实现，禁止改动本测试）：
 *
 *   src/core/session.ts 的 SessionManager 需：
 *
 *   1. 构造函数接受可选基目录（向后兼容，缺省仍是 configManager.getConfigDir()）：
 *        constructor(baseDir?: string)
 *        // this.sessionDir = path.join(baseDir ?? configManager.getConfigDir(), 'sessions')
 *      —— 这是本测试能"用临时目录、不碰真实 HOME"的前提。
 *
 *   2. 新增 deleteSession(id: string): Promise<boolean>
 *        - 防删当前会话：若 id === 当前会话 id（getCurrentSession()），返回 false
 *          且不删除任何文件；
 *        - 否则删除 <sessionDir>/<id>.json，返回 true；
 *        - 文件不存在时返回 false（幂等，不抛异常）。
 *
 *   3. 新增 setSessionCaption(id: string, caption: string): Promise<boolean>
 *        - 载入会话、写入 session.caption、持久化，返回 true；
 *        - 之后 loadSession(id) / listSessions() 返回的 caption 为新值；
 *        - 会话不存在时返回 false。
 *
 *   （daemon/routes.ts 的 DELETE /session/:id、POST /session/:id/rename 与
 *     daemonClient 对应方法由 T5 另配集成测试覆盖，本文件聚焦 core 层契约。）
 *
 *   4. 新增只读 getter getSessionDir(): string —— 返回 <base>/sessions 路径。
 *      本测试用它在做任何删除类调用前校验 manager 确实指向临时目录，
 *      防止实现不完整时误操作真实 HOME 下的会话文件。
 *
 * 断言要点：
 *   - getSessionDir 指向临时目录（HOME 隔离护栏）
 *   - deleteSession 成功删除非当前会话文件并返回 true
 *   - deleteSession 对当前会话返回 false 且文件仍在（防删当前）
 *   - deleteSession 对不存在 id 返回 false 且抛错不崩溃
 *   - setSessionCaption 后 loadSession/listSessions 返回新 caption
 *   - setSessionCaption 对不存在 id 返回 false
 *
 * 预期先红原因：SessionManager 尚无 deleteSession / setSessionCaption /
 *   getSessionDir，且构造函数尚不接受 baseDir（当前构造后 sessionDir 指向
 *   真实 HOME，本测试的护栏断言会先行变红）。
 *
 * 运行: bun run test-case/test-tui-sync-session-management.ts
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assert, assertEq, section, summary, srcPath } from './helpers/red.js';
import type { SessionManager } from '../src/core/session.js';

/** 构造最小合法 session JSON（id 与文件名一致） */
function sessionJson(id: string, caption?: string): string {
  return JSON.stringify({
    id,
    createdAt: new Date().toISOString(),
    workspace: '/tmp/alice-test-workspace',
    messages: [],
    metadata: {},
    ...(caption !== undefined ? { caption } : {}),
  });
}

async function makeTempBase(): Promise<{ base: string; cleanup: () => Promise<void> }> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'alice-red-session-'));
  const sessionsDir = path.join(base, 'sessions');
  await fs.mkdir(sessionsDir, { recursive: true });
  return {
    base,
    cleanup: () => fs.rm(base, { recursive: true, force: true }),
  };
}

async function main(): Promise<void> {
  const temp = await makeTempBase();
  const { base, cleanup } = temp;
  const sessionsDir = path.join(base, 'sessions');

  try {
    // fixture：两个会话 a（将设为当前）、b（待删）
    const idA = 'aaaaaaaa-0000-4000-8000-0000000000aa';
    const idB = 'bbbbbbbb-0000-4000-8000-0000000000bb';
    await fs.writeFile(path.join(sessionsDir, `${idA}.json`), sessionJson(idA), 'utf-8');
    await fs.writeFile(path.join(sessionsDir, `${idB}.json`), sessionJson(idB), 'utf-8');

    // 依赖 new SessionManager(baseDir) 契约；未实现时回退到真实单例（HOME 绑定），
    // 但下面只调用"新增"方法，避免对 HOME 产生写操作。
    const { SessionManager: SM } = await import(srcPath('../src/core/session.js'));
    const mgr = new (SM as unknown as new (baseDir?: string) => SessionManager)(base);

    // HOME 隔离护栏：删除类调用前必须确认 manager 指向临时目录。
    // 依赖新增的 getSessionDir() getter；未实现或仍指向真实 HOME 时直接判红并
    // 跳过后续删除断言，绝不触碰真实 ~/.alice/sessions。
    const getSessionDir = (mgr as unknown as { getSessionDir?: () => string }).getSessionDir;
    const guardOk =
      typeof getSessionDir === 'function' &&
      (getSessionDir as () => string).call(mgr) === sessionsDir;

    section('① 方法存在性（先红核心）');
    assert(
      guardOk,
      'manager.getSessionDir() === <临时目录>/sessions（HOME 隔离护栏）' +
        (typeof getSessionDir !== 'function'
          ? '（功能未实现：SessionManager 尚无 getSessionDir getter / 构造不接受 baseDir）'
          : `，实际=${(getSessionDir as () => string).call(mgr)}`),
    );
    const hasDelete = typeof (mgr as SessionManager).deleteSession === 'function';
    const hasCaption = typeof (mgr as SessionManager).setSessionCaption === 'function';
    assert(hasDelete, 'SessionManager.prototype.deleteSession 为函数' +
      (hasDelete ? '' : '（功能未实现：src/core/session.ts 尚无 deleteSession）'));
    assert(hasCaption, 'SessionManager.prototype.setSessionCaption 为函数' +
      (hasCaption ? '' : '（功能未实现：src/core/session.ts 尚无 setSessionCaption）'));

    if (!guardOk || !hasDelete || !hasCaption) {
      assert(false, 'deleteSession 成功删除非当前会话（功能未实现）');
      assert(false, 'deleteSession 防删当前会话返回 false（功能未实现）');
      assert(false, 'deleteSession 对不存在 id 返回 false（功能未实现）');
      assert(false, 'setSessionCaption 后 listSessions 返回新 caption（功能未实现）');
      assert(false, 'setSessionCaption 对不存在 id 返回 false（功能未实现）');
      summary();
      return;
    }

    section('② deleteSession 成功路径');
    const deletedOther = await mgr.deleteSession(idB);
    assertEq(deletedOther, true, 'deleteSession(非当前) 返回 true');
    let bExists = true;
    try { await fs.access(path.join(sessionsDir, `${idB}.json`)); } catch { bExists = false; }
    assertEq(bExists, false, 'deleteSession 后 <id>.json 已被删除');

    section('③ deleteSession 防删当前会话');
    await mgr.openSession(idA); // 将 a 设为当前会话
    assertEq(mgr.getCurrentSession()?.id, idA, 'openSession 后当前会话为 a');
    const deletedCurrent = await mgr.deleteSession(idA);
    assertEq(deletedCurrent, false, 'deleteSession(当前会话) 返回 false（防删）');
    let aExists = true;
    try { await fs.access(path.join(sessionsDir, `${idA}.json`)); } catch { aExists = false; }
    assertEq(aExists, true, '防删：当前会话文件仍然存在');

    section('④ deleteSession 幂等（不存在 id）');
    const deletedMissing = await mgr.deleteSession('does-not-exist');
    assertEq(deletedMissing, false, 'deleteSession(不存在 id) 返回 false 且不抛错');

    section('⑤ setSessionCaption 生效');
    const captionOk = await mgr.setSessionCaption(idA, '重构后的会话标题');
    assertEq(captionOk, true, 'setSessionCaption(存在) 返回 true');
    const reloaded = await mgr.loadSession(idA);
    assertEq(reloaded?.caption as string | undefined, '重构后的会话标题',
      'loadSession 返回新 caption');
    const listed = await mgr.listSessions();
    const listedA = listed.find((s) => s.id === idA);
    assertEq(listedA?.caption as string | undefined, '重构后的会话标题',
      'listSessions 返回新 caption');

    const captionMissing = await mgr.setSessionCaption('does-not-exist', 'x');
    assertEq(captionMissing, false, 'setSessionCaption(不存在 id) 返回 false');

    summary();
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error('test-tui-sync-session-management 异常:', err);
  process.exit(1);
});
