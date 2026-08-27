/**
 * test-case/test-tui-sync-merge-compact.ts
 *
 * TUI 融合 W7：紧凑模式 —— mergeCompactToolGroups 纯函数契约测试（先红）
 *
 * 测试文件：test-case/test-tui-sync-merge-compact.ts（本文件）
 * 实现目标（工程师照此契约实现，禁止改动本测试）：
 *
 *   新增 src/ui/utils/mergeCompactToolGroups.ts（从 qwen-code 同名文件融合，
 *   适配 alice 的 src/ui/types.ts 类型），导出：
 *
 *     export function mergeCompactToolGroups(
 *       items: HistoryItem[],
 *       embeddedShellFocused?: boolean,            // 默认 false
 *       activeShellPtyId?: number,                 // 默认 undefined
 *       absorbedCallIds?: ReadonlySet<string>,     // 默认 new Set()
 *     ): HistoryItem[]
 *
 *   行为契约（与 qwen-code 参考实现一致）：
 *   1. 空数组 / 单个可合并 tool_group / 单个非 tool_group：原样返回
 *      （返回新数组，不修改入参 items）
 *   2. 连续的「可合并 tool_group」合并为一个：tools 数组拼接（顺序不变），
 *      id 复用第一个组的 id（React key 稳定）
 *   3. 组间仅隔「紧凑模式下隐藏」的项（gemini_thought /
 *      gemini_thought_content / tool_use_summary）时仍视为连续，这些隐藏项
 *      从结果中丢弃
 *   4. 被「强制展开」的 tool_group 不参与合并，原样保留并截断合并链。
 *      强制展开条件（任一满足）：
 *        - item.isUserInitiated === true
 *        - 含 status === ToolCallStatus.Confirming 的工具（授权中）
 *        - 含 status === ToolCallStatus.Error 的工具（错误可见）
 *        - embeddedShellFocused 为 true 且含 ptyId === activeShellPtyId
 *          且 status === ToolCallStatus.Executing 的工具
 *   5. 可见的非 tool_group 项（user/gemini/info 等）原样保留并截断合并链
 *   6. tool_use_summary 项：其 precedingToolUseIds 全部在 absorbedCallIds 中
 *      时丢弃；否则保留
 *
 *   注意：alice 的 HistoryItemToolGroup 类型若尚无 isUserInitiated 字段，
 *   实现者应在 src/ui/types.ts 中为 HistoryItemToolGroup 增加可选字段
 *   `isUserInitiated?: boolean`（alice 兼容扩展，不影响现有渲染）。
 *
 * 断言要点：上述 6 条契约逐条断言（见下方各 section）。
 *
 * 预期先红原因：src/ui/utils/mergeCompactToolGroups.ts 尚不存在。
 *
 * 运行: bun run test-case/test-tui-sync-merge-compact.ts
 */

import { assert, assertEq, section, summary, importModule, srcPath } from './helpers/red.js';
import { ToolCallStatus } from '../src/ui/types.js';
import type {
  HistoryItem,
  IndividualToolCallDisplay,
} from '../src/ui/types.js';

interface MergeModule {
  mergeCompactToolGroups?: (
    items: HistoryItem[],
    embeddedShellFocused?: boolean,
    activeShellPtyId?: number,
    absorbedCallIds?: ReadonlySet<string>,
  ) => HistoryItem[];
}

/** 构造 tool_group 历史项 */
function group(id: number, tools: IndividualToolCallDisplay[], isUserInitiated?: boolean): HistoryItem {
  return {
    type: 'tool_group',
    id,
    tools,
    isUserInitiated,
  } as HistoryItem;
}

function tool(
  callId: string,
  name: string,
  status: ToolCallStatus,
  extra: Partial<IndividualToolCallDisplay> = {},
): IndividualToolCallDisplay {
  return {
    callId,
    name,
    description: `${name} description`,
    status,
    resultDisplay: undefined,
    confirmationDetails: undefined,
    ...extra,
  };
}

const thought = (id: number): HistoryItem =>
  ({ type: 'gemini_thought', id, text: 'thinking…' } as HistoryItem);
const user = (id: number, text: string): HistoryItem =>
  ({ type: 'user', id, text } as HistoryItem);
const summaryItem = (id: number, precedingToolUseIds: string[]): HistoryItem =>
  ({ type: 'tool_use_summary', id, precedingToolUseIds, text: 'summary' } as HistoryItem);

const callIdsOf = (item: HistoryItem): string[] =>
  item.type === 'tool_group' ? item.tools.map((t) => t.callId) : [];
const typesOf = (items: HistoryItem[]): string[] => items.map((i) => i.type);

async function main(): Promise<void> {
  section('① 空数组 / 单项原样返回');
  const { mod, error } = await importModule<MergeModule>(srcPath('../src/ui/utils/mergeCompactToolGroups.js'));
  const merge = mod?.mergeCompactToolGroups;

  if (!merge) {
    assert(false, 'mergeCompactToolGroups 存在且可调用' +
      `（功能未实现：src/ui/utils/mergeCompactToolGroups.ts 缺失；${error ?? '未知原因'}）`);
    for (const msg of [
      '空数组 → []（功能未实现）',
      '单个可合并 tool_group 原样返回（功能未实现）',
      '连续两个可合并 tool_group 合并为一个（功能未实现）',
      'thought 间隔的两个 tool_group 合并且 thought 丢弃（功能未实现）',
      '强制展开（Confirming）不合并（功能未实现）',
      '强制展开（Error）不合并（功能未实现）',
      'isUserInitiated 组不合并（功能未实现）',
      '聚焦 shell Executing 组不合并（功能未实现）',
      'tool_use_summary 全部吸收时丢弃（功能未实现）',
      'tool_use_summary 部分吸收时保留（功能未实现）',
      '不修改入参数组（功能未实现）',
    ]) {
      assert(false, msg);
    }
    summary();
    return;
  }

  assertEq(merge([]), [], '空数组 → []');

  const single = group(1, [tool('c1', 'Shell', ToolCallStatus.Success)]);
  assertEq(merge([single]), [single], '单个可合并 tool_group 原样返回');

  const onlyUser = [user(1, 'hello')];
  assertEq(merge(onlyUser), onlyUser, '单个非 tool_group 原样返回');

  section('② 连续 tool_group 合并');
  const mergedTwo = merge([
    group(1, [tool('c1', 'Shell', ToolCallStatus.Success)]),
    group(2, [tool('c2', 'Shell', ToolCallStatus.Success)]),
  ]);
  assertEq(mergedTwo.length, 1, '连续两个组合并为一个');
  if (mergedTwo.length === 1 && mergedTwo[0].type === 'tool_group') {
    assertEq(
      callIdsOf(mergedTwo[0]),
      ['c1', 'c2'],
      '合并后 tools 顺序拼接为 [c1, c2]',
    );
    assertEq(mergedTwo[0].id, 1, '合并组 id 复用第一个组的 id（React key 稳定）');
  }

  section('③ 隐藏项不阻断合并且被丢弃');
  const withThought = merge([
    group(1, [tool('c1', 'Shell', ToolCallStatus.Success)]),
    thought(100),
    group(2, [tool('c2', 'Shell', ToolCallStatus.Success)]),
  ]);
  assertEq(typesOf(withThought), ['tool_group'], 'thought 间隔的两个组仍合并，thought 被丢弃');
  if (withThought.length === 1 && withThought[0].type === 'tool_group') {
    assertEq(callIdsOf(withThought[0]), ['c1', 'c2'], 'thought 间隔合并后 tools 为 [c1, c2]');
  }

  section('④ 强制展开条件（任一满足即不合并）');
  const confirming = merge([
    group(1, [tool('c1', 'Shell', ToolCallStatus.Confirming)]),
    group(2, [tool('c2', 'Shell', ToolCallStatus.Success)]),
  ]);
  assertEq(typesOf(confirming), ['tool_group', 'tool_group'], '含 Confirming 工具的组强制展开，不合并');

  const errGroup = merge([
    group(1, [tool('c1', 'Shell', ToolCallStatus.Error)]),
    group(2, [tool('c2', 'Shell', ToolCallStatus.Success)]),
  ]);
  assertEq(typesOf(errGroup), ['tool_group', 'tool_group'], '含 Error 工具的组强制展开，不合并');

  const userInitiated = merge([
    group(1, [tool('c1', 'Shell', ToolCallStatus.Success)], true),
    group(2, [tool('c2', 'Shell', ToolCallStatus.Success)]),
  ]);
  assertEq(typesOf(userInitiated), ['tool_group', 'tool_group'], 'isUserInitiated 组强制展开，不合并');

  const focusedShell = merge(
    [
      group(1, [tool('c1', 'Shell', ToolCallStatus.Executing, { ptyId: 7 })]),
      group(2, [tool('c2', 'Shell', ToolCallStatus.Success)]),
    ],
    true,
    7,
  );
  assertEq(typesOf(focusedShell), ['tool_group', 'tool_group'], '聚焦 shell 的 Executing 组强制展开，不合并');

  // 反例：shell 未聚焦时同组可正常合并
  const unfocusedShell = merge(
    [
      group(1, [tool('c1', 'Shell', ToolCallStatus.Executing, { ptyId: 7 })]),
      group(2, [tool('c2', 'Shell', ToolCallStatus.Success)]),
    ],
    false,
    7,
  );
  assertEq(unfocusedShell.length, 1, 'shell 未聚焦时 Executing 组可合并');

  section('⑤ 可见项截断合并链');
  const broken = merge([
    group(1, [tool('c1', 'Shell', ToolCallStatus.Success)]),
    user(2, '中间用户消息'),
    group(3, [tool('c2', 'Shell', ToolCallStatus.Success)]),
  ]);
  assertEq(typesOf(broken), ['tool_group', 'user', 'tool_group'], '可见 user 项截断合并链，三组各自保留');

  section('⑥ tool_use_summary 吸收逻辑');
  const absorbed = merge(
    [
      group(1, [tool('c1', 'Shell', ToolCallStatus.Success)]),
      summaryItem(10, ['c1']),
      group(2, [tool('c2', 'Shell', ToolCallStatus.Success)]),
    ],
    false,
    undefined,
    new Set(['c1']),
  );
  // c1 全被吸收 → summary 丢弃；两个组跨 summary 合并为一个
  assertEq(
    typesOf(absorbed),
    ['tool_group'],
    'precedingToolUseIds 全部吸收时 summary 丢弃、两组跨其合并',
  );

  const partial = merge(
    [summaryItem(10, ['c1', 'cX'])],
    false,
    undefined,
    new Set(['c1']),
  );
  assertEq(typesOf(partial), ['tool_use_summary'], '部分吸收时 summary 保留');

  section('⑦ 纯函数：不修改入参');
  const input = [
    group(1, [tool('c1', 'Shell', ToolCallStatus.Success)]),
    group(2, [tool('c2', 'Shell', ToolCallStatus.Success)]),
  ];
  const inputSnapshot = JSON.stringify(input);
  merge(input);
  assertEq(JSON.stringify(input), inputSnapshot, '入参数组未被修改（返回新数组）');

  summary();
}

main().catch((err) => {
  console.error('test-tui-sync-merge-compact 异常:', err);
  process.exit(1);
});
