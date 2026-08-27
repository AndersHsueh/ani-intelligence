/**
 * test-case/test-tui-sync-new-commands.ts
 *
 * TUI 融合 W1/W2/W3/W4/W5/W6：新 slash 命令 —— 存在性 + 基本 action 返回结构（先红）
 *
 * 测试文件：test-case/test-tui-sync-new-commands.ts（本文件）
 * 实现目标（工程师照此契约实现，禁止改动本测试）：
 *
 *   在 src/ui/commands/ 下新增并具名导出以下命令（均为 SlashCommand，
 *   kind === CommandKind.BUILT_IN，已在 BuiltinCommandLoader 注册）：
 *
 *     doctorCommand    name 'doctor'    （W2 环境自检）
 *     rememberCommand  name 'remember'  （W3 记忆，submit_prompt 降级版）
 *     planCommand      name 'plan'      （W4 计划模式开关）
 *     contextCommand   name 'context'   （W1 上下文用量明细）
 *     deleteCommand    name 'delete'    （W5 删除会话，防删当前）
 *     renameCommand    name 'rename'    （W6 会话改名）
 *
 *   每个命令对象须满足 SlashCommand 契约：
 *     - name 与期望一致
 *     - kind === CommandKind.BUILT_IN
 *     - description 为非空字符串
 *     - 提供 action（函数）或 subCommands（数组）之一
 *
 *   可确定性调用的 action 返回结构（用最小 mock context 触发错误路径）：
 *     - rememberCommand.action(ctx, '')           → { type:'message', messageType:'error', content: 含 usage 提示 }
 *       （无参数时不应访问 context，直接返回 usage 错误）
 *     - planCommand.action({ services:{ config:null } }, '') → { type:'message', messageType:'error', ... }
 *       （config 缺失时返回错误消息，不崩溃）
 *
 * 断言要点：
 *   - 6 个命令模块均可导入且导出对应具名常量
 *   - 各自满足 SlashCommand 基本契约（name/kind/description/action|subCommands）
 *   - remember 空参返回 message/error
 *   - plan 无 config 返回 message/error
 *
 * 预期先红原因：上述 6 个命令模块在 alice 中均不存在。
 *
 * 运行: bun run test-case/test-tui-sync-new-commands.ts
 */

import { assert, assertEq, section, summary, importModule, srcPath } from './helpers/red.js';
import { CommandKind, type SlashCommand } from '../src/ui/commands/types.js';

interface CommandModule {
  [exportName: string]: unknown;
}

interface NewCommandSpec {
  exportName: string; // 具名导出
  fileName: string;   // src/ui/commands/<fileName>.ts
  name: string;       // SlashCommand.name
  feature: string;
}

const SPECS: NewCommandSpec[] = [
  { exportName: 'doctorCommand', fileName: 'doctorCommand', name: 'doctor', feature: 'W2 /doctor' },
  { exportName: 'rememberCommand', fileName: 'rememberCommand', name: 'remember', feature: 'W3 /remember' },
  { exportName: 'planCommand', fileName: 'planCommand', name: 'plan', feature: 'W4 /plan' },
  { exportName: 'contextCommand', fileName: 'contextCommand', name: 'context', feature: 'W1 /context' },
  { exportName: 'deleteCommand', fileName: 'deleteCommand', name: 'delete', feature: 'W5 /delete' },
  { exportName: 'renameCommand', fileName: 'renameCommand', name: 'rename', feature: 'W6 /rename' },
];

async function main(): Promise<void> {
  section('① 命令存在性与 SlashCommand 基本契约');
  const loaded: Record<string, SlashCommand | null> = {};
  for (const spec of SPECS) {
    const { mod, error } = await importModule<CommandModule>(
      srcPath(`../src/ui/commands/${spec.fileName}.js`),
    );
    const cmd = mod?.[spec.exportName] as SlashCommand | undefined;
    const ok =
      !!cmd &&
      cmd.name === spec.name &&
      cmd.kind === CommandKind.BUILT_IN &&
      typeof cmd.description === 'string' && cmd.description.length > 0 &&
      (typeof cmd.action === 'function' ||
        (Array.isArray(cmd.subCommands) && cmd.subCommands.length > 0));

    loaded[spec.name] = ok ? cmd : null;
    assert(
      ok,
      `${spec.feature}：${spec.exportName} 存在且为合法 BUILT_IN SlashCommand` +
        (!cmd
          ? `（功能未实现：src/ui/commands/${spec.fileName}.ts 缺失或无 ${spec.exportName} 导出；${error ?? ''}）`
          : `（实际 name=${cmd.name}, kind=${cmd.kind}）`),
    );
  }

  section('② rememberCommand 空参 → message/error（usage 提示）');
  const remember = loaded['remember'] as SlashCommand | null;
  if (!remember || typeof remember.action !== 'function') {
    assert(false, 'remember 空参返回 { type:"message", messageType:"error" }（功能未实现）');
  } else {
    const ret = await remember.action({} as never, '');
    const isMsg =
      !!ret && (ret as { type?: string }).type === 'message' &&
      (ret as { messageType?: string }).messageType === 'error';
    assert(isMsg, 'remember 无参数返回 message/error（含 usage 提示，不访问 context）');
  }

  section('③ planCommand 无 config → message/error（不崩溃）');
  const plan = loaded['plan'] as SlashCommand | null;
  if (!plan || typeof plan.action !== 'function') {
    assert(false, 'plan 无 config 返回 { type:"message", messageType:"error" }（功能未实现）');
  } else {
    let ret: unknown = undefined;
    let threw = false;
    try {
      ret = await plan.action({ services: { config: null } } as never, '');
    } catch {
      threw = true;
    }
    const isMsg =
      !threw &&
      !!ret && (ret as { type?: string }).type === 'message' &&
      (ret as { messageType?: string }).messageType === 'error';
    assert(isMsg, 'plan 在 config 缺失时返回 message/error 而非抛错');
  }

  assertEq(SPECS.length, 6, '共 6 个新命令纳入验收');

  summary();
}

main().catch((err) => {
  console.error('test-tui-sync-new-commands 异常:', err);
  process.exit(1);
});
