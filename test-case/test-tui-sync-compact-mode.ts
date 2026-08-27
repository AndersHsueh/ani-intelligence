/**
 * test-case/test-tui-sync-compact-mode.ts
 *
 * TUI 融合 W7：紧凑模式 Ctrl+O —— 先红测试（TDD 第一阶段）
 *
 * 测试文件：test-case/test-tui-sync-compact-mode.ts（本文件）
 * 实现目标（工程师须实现，禁止改动本测试）：
 *   1. src/config/keyBindings.ts 的 Command 枚举新增成员：
 *        TOGGLE_COMPACT_MODE = 'toggleCompactMode'
 *   2. defaultKeyBindings 为该命令新增默认绑定：[{ key: 'o', ctrl: true }]
 *   3. src/ui/keyMatchers.ts 的 KeyMatchers 类型（由 Command 映射）自动包含
 *      TOGGLE_COMPACT_MODE 分支（createKeyMatchers 遍历 Object.values(Command)，
 *      无需额外改动）；按 Ctrl+O 触发紧凑模式开/关的 UI 接线不在本测试范围
 *      （由 AppContainer 回归测试 + 手工验收覆盖，保证外观不变）。
 *
 * 断言要点：
 *   - Command.TOGGLE_COMPACT_MODE 存在且值为 'toggleCompactMode'
 *   - keyMatchers(Command.TOGGLE_COMPACT_MODE) 对 ctrl+o 返回 true
 *   - 对纯 'o'、ctrl+p 返回 false（不能误触发）
 *   - defaultKeyBindings[TOGGLE_COMPACT_MODE] 恰好绑定 [{ key:'o', ctrl:true }]
 *   - StickyTodoList 配套 settings：general.stickyTodos 默认 false（见下方）
 *
 * 预期先红原因：Command 枚举尚无 TOGGLE_COMPACT_MODE 成员，且
 * defaultKeyBindings 未绑定 Ctrl+O（qwen-code 已有，alice 未融合）。
 *
 * 运行: bun run test-case/test-tui-sync-compact-mode.ts
 */

import os from 'node:os';
import path from 'node:path';
import { assert, assertEq, section, summary, importModule, srcPath } from './helpers/red.js';

/**
 * 类型契约（编译期守卫）：实现落地后这两行即生效——
 *  Command 必须有 TOGGLE_COMPACT_MODE 成员；KeyMatchers 必须有同名分支。
 *  当前先红阶段这两行为 TS 类型错误（bun run 不做类型检查，不影响运行）。
 */
import type { Command as KeyBindingsCommand } from '../src/config/keyBindings.js';
import type { KeyMatchers } from '../src/ui/keyMatchers.js';
import type { Key } from '../src/ui/hooks/useKeypress.js';
type _CompactCommandContract = KeyBindingsCommand['TOGGLE_COMPACT_MODE'];
type _CompactMatchersContract = KeyMatchers['TOGGLE_COMPACT_MODE'];

const createKey = (name: string, mods: Partial<Key> = {}): Key => ({
  name,
  ctrl: false,
  meta: false,
  shift: false,
  paste: false,
  sequence: name,
  ...mods,
});

interface KeyBindingsModule {
  Command: Record<string, string>;
  defaultKeyBindings: Record<string, readonly unknown[]>;
}
interface KeyMatchersModule {
  keyMatchers: Record<string, (key: Key) => boolean>;
}

async function main(): Promise<void> {
  section('① Command.TOGGLE_COMPACT_MODE 枚举成员');
  const keyBindings = await importModule<KeyBindingsModule>(
    srcPath('../src/config/keyBindings.js'),
  );
  const command = keyBindings.mod?.Command as Record<string, string> | undefined;
  const member = command?.['TOGGLE_COMPACT_MODE'];
  assert(
    member === 'toggleCompactMode',
    `Command.TOGGLE_COMPACT_MODE === 'toggleCompactMode'` +
      (member === undefined
        ? '（功能未实现：src/config/keyBindings.ts 尚无该枚举成员）'
        : `，实际=${JSON.stringify(member)}`),
  );

  section('② keyMatchers 对 Ctrl+O 的匹配');
  const matchers = await importModule<KeyMatchersModule>(
    srcPath('../src/ui/keyMatchers.js'),
  );
  // 注：keyMatchers 按枚举值（'toggleCompactMode'）键控——与全库约定一致（键为枚举值而非成员名）
  const matcher = (matchers.mod?.keyMatchers as Record<string, (key: Key) => boolean> | undefined)
    ?.['toggleCompactMode'];
  if (!matcher) {
    assert(false, 'keyMatchers[TOGGLE_COMPACT_MODE] 存在' +
      `（功能未实现：${matchers.error ?? 'keyMatchers 未含 TOGGLE_COMPACT_MODE 分支'}）`);
  } else {
    assert(matcher(createKey('o', { ctrl: true })) === true, 'Ctrl+O 命中 TOGGLE_COMPACT_MODE');
    assert(matcher(createKey('o')) === false, '纯 o 不命中（必须带 Ctrl）');
    assert(matcher(createKey('p', { ctrl: true })) === false, 'Ctrl+P 不命中（不与历史导航冲突）');
  }

  section('③ defaultKeyBindings 的 Ctrl+O 绑定声明');
  // 注：defaultKeyBindings 按枚举值（'toggleCompactMode'）键控——与全库约定一致
  const defaultForCompact = keyBindings.mod?.defaultKeyBindings?.['toggleCompactMode'];
  if (defaultForCompact === undefined) {
    assert(false, 'defaultKeyBindings[TOGGLE_COMPACT_MODE] = [{ key: "o", ctrl: true }]' +
      '（功能未实现：默认绑定未声明）');
  } else {
    assertEq(
      defaultForCompact as unknown,
      [{ key: 'o', ctrl: true }] as unknown,
      '默认绑定恰为 [{ key: "o", ctrl: true }]',
    );
  }

  section('④ 配套 settings：general.stickyTodos 默认 false（外观不变红线）');
  // 契约：W8 StickyTodoList 新增 settings general.stickyTodos，默认必须为 false，
  // 保证默认外观与改动前逐像素一致（冻结计划 T2 验收 a）。
  const schema = await importModule<Record<string, unknown>>(
    srcPath('../src/config/settingsSchema.js'),
  );
  const findSticky = (node: unknown): Record<string, unknown> | null => {
    if (!node || typeof node !== 'object') return null;
    const record = node as Record<string, unknown>;
    if (record['stickyTodos'] && typeof record['stickyTodos'] === 'object') {
      return record['stickyTodos'] as Record<string, unknown>;
    }
    for (const value of Object.values(record)) {
      const found = findSticky(value);
      if (found) return found;
    }
    return null;
  };
  const sticky = schema.mod ? findSticky(schema.mod) : null;
  if (!sticky) {
    assert(false, 'settingsSchema general.stickyTodos 存在（type boolean, default false）' +
      '（功能未实现：schema 尚无该键；实现后默认必须为 false）');
  } else {
    assertEq(sticky['type'] as string, 'boolean', 'stickyTodos 类型为 boolean');
    assertEq(sticky['default'] as unknown, false, 'stickyTodos 默认 false（默认外观不变）');
  }

  // 自检：home 隔离环境可用（防止误伤真实 HOME 的护栏演示）
  const tempRoot = path.join(os.tmpdir(), `alice-red-check-${process.pid}-${Date.now()}`);
  assert(typeof tempRoot === 'string' && tempRoot.startsWith(os.tmpdir()), '临时目录 fixture 构造正常（不触碰真实 HOME）');

  summary();
}

main().catch((error) => {
  console.error('test-tui-sync-compact-mode 异常:', error);
  process.exit(1);
});
