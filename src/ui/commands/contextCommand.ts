/**
 * /context 上下文用量明细（W1，融合自 qwen-code contextCommand.ts 裁剪版）
 *
 * 裁剪范围：只做总用量 + System Prompt / Tools / History 三大类明细，
 * 砍掉 MCP / Skill / Memory 细分。estimateTokens 启发式与 qwen 保持一致。
 *
 * alice 后端无 API token 计数回传，总用量恒为估算值（isEstimated）。
 */

import type { CommandContext, SlashCommand } from './types.js';
import { CommandKind } from './types.js';
import {
  MessageType,
  type HistoryItemContextUsage,
  type ContextToolDetail,
} from '../types.js';
import { DEFAULT_TOKEN_LIMIT } from '../../shim/qwen-code-core.js';

/**
 * Estimate token count for a string using a character-based heuristic.
 * ASCII chars ≈ 4 chars/token, CJK/non-ASCII chars ≈ 1.5 tokens/char.
 */
function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;
  let asciiChars = 0;
  let nonAsciiChars = 0;
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    if (charCode < 128) {
      asciiChars++;
    } else {
      nonAsciiChars++;
    }
  }
  // CJK and other non-ASCII characters typically produce 1.5-2 tokens each
  return Math.ceil(asciiChars / 4 + nonAsciiChars * 1.5);
}

/** System Prompt 估算：daemon 启动时从 agents/*.md 加载，UI 侧以固定占位 + 模型名估算 */
function estimateSystemPromptTokens(): number {
  // daemon 侧 system prompt 由 configManager.loadSystemPrompt() 加载，
  // UI 无法直接读取；用 alice 固定引导词的估算值兜底（与空会话场景量级一致）。
  return estimateTokens('You are ALICE, an AI office assistant.');
}

/** Tools 明细：alice 工具注册表通过 config 不可达，这里按 /tools 列表兜底为空明细 */
function collectToolDetails(_context: CommandContext): ContextToolDetail[] {
  return [];
}

export async function collectContextData(
  context: CommandContext,
  showDetails: boolean,
): Promise<HistoryItemContextUsage> {
  const config = context.services.config;
  const modelName = config?.getModel() || 'unknown';
  const contextWindowSize = DEFAULT_TOKEN_LIMIT;

  const systemPromptTokens = estimateSystemPromptTokens();
  const toolDetails = showDetails ? collectToolDetails(context) : [];
  const toolsTokens = toolDetails.reduce((sum, t) => sum + t.tokens, 0);

  // 对话历史：从 UI history 提取 user/gemini 文本估算
  const historyItems = (
    context.ui as unknown as {
      history?: Array<{ type?: string; text?: string }>;
    }
  ).history ?? [];
  const historyTexts: string[] = [];
  for (const item of historyItems) {
    if (
      (item.type === 'user' || item.type === 'gemini' || item.type === 'gemini_content') &&
      typeof item.text === 'string'
    ) {
      historyTexts.push(item.text);
    }
  }
  const messagesTokens = estimateTokens(historyTexts.join('\n'));

  const rawOverhead = systemPromptTokens + toolsTokens;
  const totalTokens = rawOverhead + messagesTokens;

  const breakdown = {
    systemPrompt: systemPromptTokens,
    tools: toolsTokens,
    messages: messagesTokens,
    freeSpace: Math.max(0, contextWindowSize - totalTokens),
  };

  return {
    type: MessageType.CONTEXT_USAGE,
    modelName,
    totalTokens,
    contextWindowSize,
    breakdown,
    toolDetails,
    isEstimated: true,
    showDetails,
  };
}

/**
 * Format token count for display (e.g. 1234 -> "1.2k", 123456 -> "123.5k")
 */
function fmtTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return `${tokens}`;
}

/**
 * Format a category row as text: "  label .............. 1.2k tokens (3.4%)"
 */
function fmtCategoryRow(
  label: string,
  tokens: number,
  contextWindowSize: number,
  indent = '  ',
): string {
  const percentage = ((tokens / contextWindowSize) * 100).toFixed(1);
  const right = `${fmtTokens(tokens)} tokens (${percentage}%)`;
  const leftPart = `${indent}${label}`;
  const totalWidth = 56;
  const dots = Math.max(1, totalWidth - leftPart.length - right.length);
  return `${leftPart}${' '.repeat(dots)}${right}`;
}

/**
 * Convert a HistoryItemContextUsage to a human-readable text string,
 * mirroring the layout of the interactive ContextUsage component.
 */
export function formatContextUsageText(data: HistoryItemContextUsage): string {
  const {
    modelName,
    totalTokens,
    contextWindowSize,
    breakdown,
    toolDetails,
    isEstimated,
    showDetails,
  } = data;

  const lines: string[] = [];
  lines.push('## Context Usage');
  lines.push('');

  if (isEstimated) {
    lines.push('*No API response yet. Showing estimated usage.*');
    lines.push('');
    lines.push('**Estimated overhead**');
  }
  lines.push(
    `Model: ${modelName}  Context window: ${fmtTokens(contextWindowSize)} tokens`,
  );
  lines.push('');
  lines.push(fmtCategoryRow('Used', totalTokens, contextWindowSize));
  lines.push(fmtCategoryRow('Free', breakdown.freeSpace, contextWindowSize));
  lines.push('');
  lines.push('**Usage by category**');
  lines.push(fmtCategoryRow('System prompt', breakdown.systemPrompt, contextWindowSize));
  lines.push(fmtCategoryRow('Tools', breakdown.tools, contextWindowSize));
  lines.push(fmtCategoryRow('History', breakdown.messages, contextWindowSize));

  if (showDetails && toolDetails.length > 0) {
    lines.push('');
    lines.push('**Tools**');
    const sorted = [...toolDetails].sort((a, b) => b.tokens - a.tokens);
    for (const tool of sorted) {
      lines.push(fmtCategoryRow(tool.name, tool.tokens, contextWindowSize, '  └ '));
    }
  } else if (!showDetails) {
    lines.push('');
    lines.push('*Run /context detail for per-item breakdown.*');
  }

  return lines.join('\n');
}

export const contextCommand: SlashCommand = {
  name: 'context',
  description:
    'Show context window usage breakdown. Use "/context detail" for per-item breakdown.',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext, args?: string) => {
    const showDetails =
      args?.trim().toLowerCase() === 'detail' ||
      args?.trim().toLowerCase() === '-d';
    const executionMode = context.executionMode ?? 'interactive';

    const contextUsageItem = await collectContextData(context, showDetails);

    if (executionMode === 'interactive') {
      context.ui.addItem(contextUsageItem, Date.now());
      return undefined;
    }
    return {
      type: 'message',
      messageType: 'info',
      content: formatContextUsageText(contextUsageItem),
    };
  },
  subCommands: [
    {
      name: 'detail',
      description: 'Show per-item context usage breakdown.',
      kind: CommandKind.BUILT_IN,
      action: async (context: CommandContext) => {
        // Delegate to main action with 'detail' arg to show detailed view
        await contextCommand.action?.(context, 'detail');
      },
    },
  ],
};
