/**
 * /plan 计划模式命令（W4，融合自 qwen-code planCommand.ts）
 *
 * 进入/退出计划模式：切换 Config 的 ApprovalMode 到 PLAN；带参数时顺带
 * 提交该参数作为 prompt。依赖 shim Config 的内存态
 * getApprovalMode/setApprovalMode/getPrePlanMode。
 */

import {
  type CommandContext,
  CommandKind,
  type SlashCommand,
} from './types.js';
import { ApprovalMode } from '@qwen-code/qwen-code-core';

export const planCommand: SlashCommand = {
  name: 'plan',
  description: 'Switch to plan mode or exit plan mode',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ) => {
    const { config } = context.services;
    if (!config) {
      return {
        type: 'message' as const,
        messageType: 'error' as const,
        content: 'Configuration is not available.',
      };
    }

    const trimmedArgs = args.trim();
    const currentMode = config.getApprovalMode();

    if (trimmedArgs === 'exit') {
      if (currentMode !== ApprovalMode.PLAN) {
        return {
          type: 'message' as const,
          messageType: 'error' as const,
          content:
            'Not in plan mode. Use "/plan" to enter plan mode first.',
        };
      }
      try {
        config.setApprovalMode(config.getPrePlanMode());
      } catch (error: unknown) {
        return {
          type: 'message' as const,
          messageType: 'error' as const,
          content:
            error instanceof Error
              ? error.message
              : 'Failed to exit plan mode.',
        };
      }
      return {
        type: 'message' as const,
        messageType: 'info' as const,
        content: 'Exited plan mode. Previous approval mode restored.',
      };
    }

    if (currentMode !== ApprovalMode.PLAN) {
      try {
        config.setApprovalMode(ApprovalMode.PLAN);
      } catch (error: unknown) {
        return {
          type: 'message' as const,
          messageType: 'error' as const,
          content:
            error instanceof Error
              ? error.message
              : 'Failed to enter plan mode.',
        };
      }

      if (trimmedArgs) {
        return {
          type: 'submit_prompt' as const,
          content: [{ text: trimmedArgs }],
        };
      }

      return {
        type: 'message' as const,
        messageType: 'info' as const,
        content:
          'Enabled plan mode. The agent will analyze and plan without executing tools.',
      };
    }

    // Already in plan mode
    if (trimmedArgs) {
      return {
        type: 'submit_prompt' as const,
        content: [{ text: trimmedArgs }],
      };
    }

    return {
      type: 'message' as const,
      messageType: 'info' as const,
      content: 'Already in plan mode. Use "/plan exit" to exit plan mode.',
    };
  },
};
