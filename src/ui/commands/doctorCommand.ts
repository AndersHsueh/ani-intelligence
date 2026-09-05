/**
 * /doctor 环境自检命令（W2，融合自 qwen-code doctorCommand.ts 裁剪版）
 *
 * 交互模式：执行检查后向 history 追加 HistoryItemDoctor（由 DoctorReport 渲染）；
 * 非交互模式：返回 message/info（有 fail 时 message/error）。
 */

import type { CommandContext, SlashCommand } from './types.js';
import { CommandKind } from './types.js';
import type { HistoryItemDoctor } from '../types.js';
import { runDoctorChecks } from '../utils/doctorChecks.js';

export const doctorCommand: SlashCommand = {
  name: 'doctor',
  description: 'Run installation and environment diagnostics',
  // qwen-code 专属：ALICE 架构不同
  hidden: true,
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext) => {
    const executionMode = context.executionMode ?? 'interactive';
    const abortSignal = context.abortSignal;

    if (executionMode === 'interactive') {
      context.ui.setPendingItem({
        type: 'info',
        text: 'Running diagnostics...',
      });
    }

    try {
      const checks = await runDoctorChecks();

      if (abortSignal?.aborted) {
        return undefined;
      }

      const summary = {
        pass: checks.filter((c) => c.status === 'pass').length,
        warn: checks.filter((c) => c.status === 'warn').length,
        fail: checks.filter((c) => c.status === 'fail').length,
      };

      if (executionMode === 'interactive') {
        const doctorItem: Omit<HistoryItemDoctor, 'id'> = {
          type: 'doctor',
          checks,
          summary,
        };
        context.ui.addItem(doctorItem, Date.now());
        return undefined;
      }

      return {
        type: 'message' as const,
        messageType: (summary.fail > 0 ? 'error' : 'info') as 'error' | 'info',
        content: JSON.stringify({ checks, summary }, null, 2),
      };
    } finally {
      if (executionMode === 'interactive') {
        context.ui.setPendingItem(null);
      }
    }
  },
};
