/**
 * /rename 会话改名命令（W6，融合自 qwen-code renameCommand.ts 降级版）
 *
 * - `/rename <name>`：直接以给定名称改名；
 * - `/rename`（无参数）：AI 起名的降级实现 —— 截取当前会话首条用户消息
 *   前 40 字符作为标题（不做 LLM 调用）。
 *
 * 改名经 daemonClient.renameSession → daemon POST /session/:id/rename →
 * SessionManager.setSessionCaption 持久化。
 */

import type { CommandContext, SlashCommand } from './types.js';
import { CommandKind } from './types.js';
import { daemonClient } from '../../utils/daemonClientInstance.js';
import { getErrorMessage } from '../../utils/errors.js';

const MAX_TITLE_LENGTH = 200;
const FALLBACK_TITLE_MAX_LENGTH = 40;

/** 无参数时的降级标题：取首条用户消息前 40 字符。 */
function deriveFallbackTitle(context: CommandContext): string | null {
  const history = (
    context.ui as unknown as {
      history?: Array<{ type?: string; text?: string }>;
    }
  ).history ?? [];
  for (const item of history) {
    if (item.type === 'user' && typeof item.text === 'string') {
      const text = item.text.trim();
      if (text.length > 0) {
        const firstLine = text.split('\n')[0]?.trim() ?? '';
        const source = firstLine.length > 0 ? firstLine : text;
        return source.slice(0, FALLBACK_TITLE_MAX_LENGTH);
      }
    }
  }
  return null;
}

export const renameCommand: SlashCommand = {
  name: 'rename',
  altNames: ['tag'],
  kind: CommandKind.BUILT_IN,
  description: 'Rename the current conversation',
  action: async (context: CommandContext, args: string): Promise<
    | { type: 'message'; messageType: 'info' | 'error'; content: string }
    | undefined
  > => {
    const name = args.trim();

    if (!name) {
      // 无参数：降级为首条用户消息截取 40 字符
      const fallback = deriveFallbackTitle(context);
      if (!fallback) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'Usage: /rename <name> (no user message found to derive a title from)',
        };
      }
      return finalizeRename(context, fallback);
    }

    if (name.length > MAX_TITLE_LENGTH) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Name is too long. Maximum ${MAX_TITLE_LENGTH} characters.`,
      };
    }

    return finalizeRename(context, name);
  },
};

async function finalizeRename(
  context: CommandContext,
  name: string,
): Promise<{ type: 'message'; messageType: 'info' | 'error'; content: string }> {
  const config = context.services.config;
  const sessionId = config?.getSessionId();
  if (!sessionId) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'No active session to rename.',
    };
  }

  try {
    const ok = await daemonClient.renameSession(sessionId, name);
    if (!ok) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Failed to rename session.',
      };
    }
  } catch (error: unknown) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to rename session: ${getErrorMessage(error)}`,
    };
  }

  return {
    type: 'message',
    messageType: 'info',
    content: `Session renamed to "${name}"`,
  };
}
