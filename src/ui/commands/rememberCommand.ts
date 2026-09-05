/**
 * /remember 记忆命令（W3，融合自 qwen-code rememberCommand.ts 降级版）
 *
 * alice 无 managed memory 系统，仅实现非 managed 路径：提交一条 prompt
 * 让主 agent 用其原生文件工具把事实追加到记忆文件（项目根 QWEN.md）。
 */

import type {
  CommandContext,
  SlashCommand,
} from './types.js';
import { CommandKind } from './types.js';

export const rememberCommand: SlashCommand = {
  name: 'remember',
  description: 'Save a durable memory (append to QWEN.md via the agent)',
  // qwen-code 专属：ALICE 使用 ~/.alice/memories/
  hidden: true,
  kind: CommandKind.BUILT_IN,
  action: (
    _context: CommandContext,
    args: string,
  ) => {
    const fact = args.trim();
    if (!fact) {
      return {
        type: 'message' as const,
        messageType: 'error' as const,
        content: 'Usage: /remember <text to remember>',
      };
    }

    // alice has no managed auto-memory: ask the agent to append the fact to
    // the project/user memory file using its native file tools.
    return {
      type: 'submit_prompt' as const,
      content: `Please save the following fact to memory (append to QWEN.md in the project root):\n\n${fact}`,
    };
  },
};
