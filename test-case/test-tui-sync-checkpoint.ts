/**
 * test-case/test-tui-sync-checkpoint.ts
 *
 * TUI 融合 W11：checkpointing 服务 —— 先红测试（TDD 第一阶段）
 *
 * 测试文件：test-case/test-tui-sync-checkpoint.ts（本文件）
 * 实现目标（工程师照此契约实现，禁止改动本测试）：
 *
 *   新增 src/services/checkpoint.ts，导出：
 *
 *     export class CheckpointService {
 *       // baseDir 缺省为 ~/.alice/checkpoints（由 configManager 推导）；
 *       // 测试必须传入临时目录（HOME 隔离，参照 test-issue-018 防护）。
 *       // 快照落在 <baseDir>/<相对或绝对路径的编码文件名>.json 或同级 .snapshot 文件。
 *       constructor(baseDir?: string);
 *
 *       // 是否启用（来自 settings general.checkpointing.enabled）。
 *       setEnabled(enabled: boolean): void;
 *
 *       // 在 editFile/writeFile 落盘前调用：
 *       // - enabled=false → 不创建任何快照，返回 null；
 *       // - enabled=true 且文件存在 → 写入该文件修改前内容快照，返回 checkpoint id；
 *       // - enabled=true 但文件不存在 → 无内容可备份，返回 null（writeFile 新文件不快照）。
 *       snapshotBeforeWrite(filePath: string): Promise<string | null>;
 *
 *       // 恢复：以 checkpoint 创建时的原始内容覆写 filePath，返回 true；
 *       // 未知 checkpoint id 或 checkpoint 丢失时抛 Error。
 *       restore(filePath: string, checkpointId: string): Promise<boolean>;
 *
 *       // 列出某文件的快照 id（按时间倒序）。
 *       list(filePath: string): Promise<string[]>;
 *     }
 *
 *   接线契约：editFile/writeFile 工具在执行磁盘写入前必须调用
 *   snapshotBeforeWrite（见冻结计划 T10 验收："checkpoint 开启时 editFile 前
 *   产生快照"）；/checkpoint restore 命令（ui/commands/checkpointCommand.ts）
 *   调用 restore。本文件只测服务层纯行为。
 *
 * 断言要点：
 *   - 关闭时不快照（snapshotBeforeWrite 返回 null 且 baseDir 无新文件）
 *   - 开启时 editFile 前产生快照（返回非空 id，list 可见）
 *   - restore 恢复修改前内容（逐字节相等）
 *   - 未知 checkpoint id / 未知文件 → 抛错
 *   - 全程只在临时目录写入，不触碰真实 HOME
 *
 * 预期先红原因：src/services/checkpoint.ts 尚不存在（占位未实现）。
 *
 * 运行: bun run test-case/test-tui-sync-checkpoint.ts
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assert, assertEq, section, summary, importModule, srcPath } from './helpers/red.js';

interface CheckpointModule {
  CheckpointService?: new (baseDir?: string) => {
    setEnabled: (enabled: boolean) => void;
    snapshotBeforeWrite: (filePath: string) => Promise<string | null>;
    restore: (filePath: string, checkpointId: string) => Promise<boolean>;
    list: (filePath: string) => Promise<string[]>;
  };
}

async function main(): Promise<void> {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'alice-red-checkpoint-'));
  const baseDir = path.join(temp, 'checkpoints');
  const workspace = path.join(temp, 'workspace');
  await fs.mkdir(workspace, { recursive: true });
  const target = path.join(workspace, 'doc.md');
  await fs.writeFile(target, '原始内容 v1', 'utf-8');

  try {
    const { mod, error } = await importModule<CheckpointModule>(
      srcPath('../src/services/checkpoint.js'),
    );
    const Ctor = mod?.CheckpointService;

    section('① 模块与类存在性（先红核心）');
    assert(
      typeof Ctor === 'function',
      'CheckpointService 类可构造（baseDir 可选注入）' +
        (typeof Ctor === 'function'
          ? ''
          : `（功能未实现：src/services/checkpoint.ts 缺失；${error ?? '未知原因'}）`),
    );

    if (typeof Ctor !== 'function') {
      for (const msg of [
        '关闭时不快照（功能未实现）',
        '开启时 editFile 前产生快照（功能未实现）',
        'restore 恢复修改前内容（功能未实现）',
        '未知 checkpoint id 抛错（功能未实现）',
        '新文件（不存在）不快照（功能未实现）',
      ]) {
        assert(false, msg);
      }
      summary();
      return;
    }

    const dirCount = async (dir: string): Promise<number> => {
      const entries = await fs.readdir(dir);
      return entries.length;
    };

    section('② 关闭时不快照（settings 默认关闭 → 默认外观/行为不变）');
    const off = new Ctor(baseDir);
    off.setEnabled(false);
    const offId = await off.snapshotBeforeWrite(target);
    assertEq(offId, null, 'setEnabled(false) 时 snapshotBeforeWrite 返回 null');
    const offEntries = await dirCount(baseDir).catch(() => -1);
    assertEq(offEntries, 0, '关闭时 checkpoints 目录无任何新文件');

    section('③ 开启时 editFile 前产生快照');
    const svc = new Ctor(baseDir);
    svc.setEnabled(true);
    const id1 = await svc.snapshotBeforeWrite(target);
    assert(typeof id1 === 'string' && id1.length > 0, 'setEnabled(true) 时返回非空 checkpoint id');
    const listed = await svc.list(target);
    assert(listed.includes(id1 ?? ''), 'list(target) 包含刚创建的 checkpoint id');

    // 模拟 editFile：写入前已有快照 id1，随后修改文件
    await fs.writeFile(target, '被修改后的内容 v2', 'utf-8');
    const afterEdit = await fs.readFile(target, 'utf-8');
    assertEq(afterEdit, '被修改后的内容 v2', '前置条件：文件确实已被修改');

    section('④ restore 恢复修改前内容');
    const restored = await svc.restore(target, id1!);
    assertEq(restored, true, 'restore 返回 true');
    const restoredContent = await fs.readFile(target, 'utf-8');
    assertEq(restoredContent, '原始内容 v1', '恢复后内容与快照逐字节一致');

    section('⑤ 错误路径');
    let unknownIdThrew = false;
    try {
      await svc.restore(target, 'no-such-checkpoint');
    } catch {
      unknownIdThrew = true;
    }
    assert(unknownIdThrew, '未知 checkpoint id 抛 Error');

    // 新文件（不存在）：无内容可备份 → 不快照
    const newFile = path.join(workspace, 'brand-new.md');
    const newFileId = await svc.snapshotBeforeWrite(newFile);
    assertEq(newFileId, null, '文件不存在时 snapshotBeforeWrite 返回 null（不产生空快照）');

    summary();
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('test-tui-sync-checkpoint 异常:', err);
  process.exit(1);
});
