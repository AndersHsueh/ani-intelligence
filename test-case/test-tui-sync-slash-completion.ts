/**
 * test-case/test-tui-sync-slash-completion.ts
 *
 * TUI 融合 W10：useSlashCompletion 排序升级 —— 纯函数契约测试（先红）
 *
 * 测试文件：test-case/test-tui-sync-slash-completion.ts（本文件）
 * 实现目标（工程师照此契约实现，禁止改动本测试）：
 *
 *   替换 src/ui/hooks/useSlashCompletion.ts 为 qwen-code 升级版后，
 *   必须从该模块**具名导出**以下纯函数（供本测试直接调用，不渲染 hook）：
 *
 *     export const COMPLETION_PRIORITY = {
 *       EXACT: 9000,              // 命令名（或 altName）与查询完全相等（忽略大小写）
 *       PREFIX: 8000,             // 命令名以查询开头（忽略大小写）
 *       SEGMENT_PREFIX: 7000,     // 查询命中某个"非字母数字字符切分后"的段首
 *                                 //   （如 query "st" 命中 "set-token"；
 *                                 //   命令名开头的斜杠不视为段边界）
 *       FUZZY: 6000,              // 查询字符按序出现在命令名中（子序列模糊匹配）
 *     } as const;
 *
 *     export type CompletionPriority =
 *       (typeof COMPLETION_PRIORITY)[keyof typeof COMPLETION_PRIORITY];
 *
 *     // 返回 EXACT > PREFIX > SEGMENT_PREFIX > FUZZY；不匹配返回 undefined。
 *     // 比较忽略大小写；查询若以 "/" 开头先剥离该斜杠。
 *     export function getCompletionPriority(
 *       cmd: Pick<SlashCommand, 'name' | 'altNames'>,
 *       query: string,
 *     ): CompletionPriority | undefined;
 *
 *     // 数值越大越强，可直接用于排序比较器；不匹配返回 -1。
 *     export function getCommandMatchStrength(
 *       cmd: Pick<SlashCommand, 'name' | 'altNames'>,
 *       query: string,
 *     ): number;
 *
 *     // 补全排序键：强度降序、同强度按 name 字典序升序（稳定、确定性）。
 *     export function completionKey(
 *       cmd: Pick<SlashCommand, 'name' | 'altNames'>,
 *       query: string,
 *     ): { strength: number; name: string };
 *
 *   断言只针对"同强度"与"相对顺序"，不针对 fzf 的具体分值，保证实现可替换。
 *
 * 断言要点：
 *   - 四个优先级常量值与严格递减关系
 *   - EXACT > PREFIX > SEGMENT_PREFIX > FUZZY 的相对顺序
 *   - getCommandMatchStrength 未命中 -1；completionKey 同强度按 name 升序
 *
 * 预期先红原因：useSlashCompletion.ts 尚无上述具名导出（排序仍为 fzf 原序）。
 *
 * 运行: bun run test-case/test-tui-sync-slash-completion.ts
 */

import { assert, assertEq, section, summary, importModule, srcPath } from './helpers/red.js';
import type { SlashCommand } from '../src/ui/commands/types.js';
import { CommandKind } from '../src/ui/commands/types.js';

type CmdLite = Pick<SlashCommand, 'name' | 'altNames'>;

interface CompletionModule {
  COMPLETION_PRIORITY?: Record<string, number>;
  getCompletionPriority?: (cmd: CmdLite, query: string) => number | undefined;
  getCommandMatchStrength?: (cmd: CmdLite, query: string) => number;
  completionKey?: (cmd: CmdLite, query: string) => { strength: number; name: string };
}

const cmd = (name: string, altNames?: string[]): CmdLite =>
  altNames ? { name, altNames } : { name };

// 固定命令集（覆盖各匹配层级）
const COMMANDS: CmdLite[] = [
  cmd('help'),
  cmd('hooks'),
  cmd('home'),
  cmd('history', ['hist']),
  cmd('set-token'),
  cmd('stats'),
];

async function main(): Promise<void> {
  section('① 模块导出存在性（先红核心）');
  const { mod, error } = await importModule<CompletionModule>(
    srcPath('../src/ui/hooks/useSlashCompletion.js'),
  );
  const priority = mod?.COMPLETION_PRIORITY;
  const getPriority = mod?.getCompletionPriority;
  const strength = mod?.getCommandMatchStrength;
  const key = mod?.completionKey;

  const missing: string[] = [];
  if (!priority) missing.push('COMPLETION_PRIORITY');
  if (typeof getPriority !== 'function') missing.push('getCompletionPriority');
  if (typeof strength !== 'function') missing.push('getCommandMatchStrength');
  if (typeof key !== 'function') missing.push('completionKey');
  assert(
    missing.length === 0,
    'useSlashCompletion 导出 COMPLETION_PRIORITY/getCompletionPriority/' +
      'getCommandMatchStrength/completionKey（功能未实现：排序升级函数尚未导出' +
      (missing.length ? `，缺 [${missing.join(', ')}]` : '') +
      (error ? `；import 失败: ${error}` : '') + '）',
  );

  if (missing.length > 0) {
    for (const msg of [
      '优先级常量值 EXACT=9000/PREFIX=8000/SEGMENT_PREFIX=7000/FUZZY=6000（功能未实现）',
      '四档严格递减（功能未实现）',
      'EXACT 命中 help（功能未实现）',
      'PREFIX 命中 help（功能未实现）',
      'SEGMENT_PREFIX 命中 set-token（功能未实现）',
      'FUZZY 命中 help（功能未实现）',
      'altName 命中（功能未实现）',
      '未命中返回 undefined/-1（功能未实现）',
      'EXACT>PREFIX>SEGMENT_PREFIX>FUZZY 相对顺序（功能未实现）',
      'completionKey 同强度按 name 升序（功能未实现）',
      '/he 回归：help 先于 hooks（功能未实现）',
    ]) {
      assert(false, msg);
    }
    summary();
    return;
  }

  const P = priority!;
  section('② 优先级常量值');
  assertEq(P['EXACT'], 9000, 'COMPLETION_PRIORITY.EXACT === 9000');
  assertEq(P['PREFIX'], 8000, 'COMPLETION_PRIORITY.PREFIX === 8000');
  assertEq(P['SEGMENT_PREFIX'], 7000, 'COMPLETION_PRIORITY.SEGMENT_PREFIX === 7000');
  assertEq(P['FUZZY'], 6000, 'COMPLETION_PRIORITY.FUZZY === 6000');
  assert(
    P['EXACT'] > P['PREFIX'] && P['PREFIX'] > P['SEGMENT_PREFIX'] &&
      P['SEGMENT_PREFIX'] > P['FUZZY'],
    '四档严格递减 EXACT > PREFIX > SEGMENT_PREFIX > FUZZY',
  );

  section('③ getCompletionPriority 各档命中');
  assertEq(getPriority!(cmd('help'), 'help'), P['EXACT'], 'query "help" 命中 help → EXACT');
  assertEq(getPriority!(cmd('help'), 'HELP'), P['EXACT'], '忽略大小写：query "HELP" → EXACT');
  assertEq(getPriority!(cmd('help'), '/help'), P['EXACT'], '查询带前导斜杠 "/help" → EXACT');
  assertEq(getPriority!(cmd('help'), 'he'), P['PREFIX'], 'query "he" 命中 help → PREFIX');
  assertEq(getPriority!(cmd('history'), 'hist'), P['PREFIX'], 'query "hist" 命中 history → PREFIX');
  assertEq(getPriority!(cmd('set-token'), 'st'), P['SEGMENT_PREFIX'], 'query "st" 命中 set-token 段首 → SEGMENT_PREFIX');
  assertEq(getPriority!(cmd('help'), 'hlp'), P['FUZZY'], 'query "hlp" 子序列命中 help → FUZZY');
  assertEq(getPriority!(cmd('history', ['hist']), 'hist'), P['PREFIX'], 'altName "hist" 命中 → PREFIX');
  assertEq(getPriority!(cmd('history'), 'z'), undefined, 'query "z" 未命中 → undefined');
  assertEq(getPriority!(cmd('help'), 'zzz'), undefined, '无子序列匹配 → undefined');

  section('④ getCommandMatchStrength 数值契约');
  assertEq(strength!(cmd('help'), 'z'), -1, '未命中强度为 -1');
  assert(
    strength!(cmd('help'), 'help') > strength!(cmd('help'), 'he'),
    'EXACT 强度 > PREFIX 强度（同命令）',
  );
  const segCmd = cmd('set-token');
  assert(
    strength!(cmd('stats'), 's') > strength!(segCmd, 'st'),
    'PREFIX 档(8000) > SEGMENT_PREFIX 档(7000)（跨命令数值可比）',
  );
  assert(
    strength!(segCmd, 'st') > strength!(cmd('help'), 'hz'),
    'SEGMENT_PREFIX 档(7000) > FUZZY 档(6000)（跨命令数值可比）',
  );

  section('⑤ completionKey 排序键（同强度按 name 升序）');
  // "h" 命中 help(8000)/hooks(8000)/home(8000)/history(8000) 同为 PREFIX 档
  const ranked = COMMANDS
    .map((c) => key!(c, 'h'))
    .sort((a, b) => b.strength - a.strength || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  assertEq(
    ranked.filter((r) => r.strength !== -1).map((r) => r.name),
    ['help', 'history', 'home', 'hooks'],
    'query "h"：同 PREFIX 强度内按 name 字典序 help < history < home < hooks',
  );

  section('⑥ 回归基线：/he 首先命中 /help（冻结计划 T4 验收 b）');
  const heRanked = [cmd('help'), cmd('hooks'), cmd('home'), cmd('history', ['hist'])]
    .map((c) => key!(c, 'he'))
    .sort((a, b) => b.strength - a.strength || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  assertEq(heRanked[0].name, 'help', '输入 /he 时补全首位为 help');

  // 编译期契约（实现落地后生效）：上述导出在模块类型上必须存在
  type _ContractGuard = [
    CompletionModule['COMPLETION_PRIORITY'],
    CompletionModule['getCompletionPriority'],
  ];

  summary();
}

// 防止 CommandKind 未使用告警（类型契约锚点：实现者不得移除 BUILT_IN 语义）
void CommandKind.BUILT_IN;

main().catch((err) => {
  console.error('test-tui-sync-slash-completion 异常:', err);
  process.exit(1);
});
