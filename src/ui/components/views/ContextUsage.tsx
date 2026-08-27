/**
 * /context 用量渲染（W1，融合自 qwen-code ContextUsage.tsx 裁剪版）
 *
 * 裁剪：System Prompt / Tools / History 三大类 + Tools 明细，
 * 砍掉 MCP / Memory / Skill 细分与 autocompact buffer 段。
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../semantic-colors.js';
import type {
  ContextCategoryBreakdown,
  ContextToolDetail,
} from '../../types.js';

const FILLED = '\u2588'; // █ - filled block
const EMPTY = '\u2591'; // ░ - light shade (free space)

const CONTENT_WIDTH = 56;

interface ContextUsageProps {
  modelName: string;
  totalTokens: number;
  contextWindowSize: number;
  breakdown: ContextCategoryBreakdown;
  /** detail 模式下的 Tools 明细 */
  toolDetails: ContextToolDetail[];
  /** True when totalTokens is estimated (no API call yet) */
  isEstimated?: boolean;
  /** When true, show per-item detail breakdowns. Default: false (compact). */
  showDetails?: boolean;
  width?: number;
}

/**
 * Truncate a string to maxLen, appending '…' if truncated.
 */
function truncateName(name: string, maxLen: number): string {
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen - 1) + '\u2026';
}

/**
 * Format token count for display (e.g. 1234 -> "1.2k", 123456 -> "123.5k")
 */
function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return `${tokens}`;
}

/**
 * Render a two-segment progress bar: used | free space.
 */
const ProgressBar: React.FC<{
  usedPercentage: number;
  width: number;
}> = ({ usedPercentage, width }) => {
  const usedCount = Math.round((Math.min(usedPercentage, 100) / 100) * width);
  const freeCount = Math.max(0, width - usedCount);

  const usedStr = FILLED.repeat(Math.max(0, usedCount));
  const freeStr = EMPTY.repeat(Math.max(0, freeCount));

  // Used color: accent by default, warning/error at high usage.
  let usedColor = theme.text.accent;
  if (usedPercentage > 80) {
    usedColor = theme.status.error;
  } else if (usedPercentage > 60) {
    usedColor = theme.status.warning;
  }

  return (
    <Text>
      <Text color={usedColor}>{usedStr}</Text>
      <Text color={theme.text.secondary}>{freeStr}</Text>
    </Text>
  );
};

/**
 * Format percentage for display, showing ">100%" when exceeding limit.
 */
function formatPercentage(tokens: number, contextWindowSize: number): string {
  if (contextWindowSize <= 0) return '0.0';
  const percentage = (tokens / contextWindowSize) * 100;
  if (percentage > 100) {
    return '>100';
  }
  return percentage.toFixed(1);
}

/**
 * A row showing a category with its token count and percentage.
 */
const CategoryRow: React.FC<{
  symbol: string;
  label: string;
  tokens: number;
  contextWindowSize: number;
  symbolColor?: string;
  isOverLimit?: boolean;
}> = ({
  symbol,
  label,
  tokens,
  contextWindowSize,
  symbolColor,
  isOverLimit,
}) => {
  const percentageStr = formatPercentage(tokens, contextWindowSize);
  const tokenStr = `${formatTokens(tokens)} tokens (${percentageStr}%)`;

  return (
    <Box width={CONTENT_WIDTH}>
      <Box width={2}>
        <Text color={symbolColor || theme.text.secondary}>{symbol}</Text>
      </Box>
      <Box width={24}>
        <Text color={theme.text.primary}>{label}</Text>
      </Box>
      <Box flexGrow={1} justifyContent="flex-end">
        <Text color={isOverLimit ? theme.status.error : theme.text.secondary}>
          {tokenStr}
        </Text>
      </Box>
    </Box>
  );
};

/**
 * A detail row for individual items (tools).
 */
const DETAIL_NAME_MAX_LEN = 30;

const DetailRow: React.FC<{
  name: string;
  tokens: number;
}> = ({ name, tokens }) => {
  const tokenStr = `${formatTokens(tokens)} tokens`;
  return (
    <Box width={CONTENT_WIDTH} paddingLeft={2}>
      <Text color={theme.text.secondary}>{'\u2514'} </Text>
      <Box width={32}>
        <Text color={theme.text.link}>
          {truncateName(name, DETAIL_NAME_MAX_LEN)}
        </Text>
      </Box>
      <Box flexGrow={1} justifyContent="flex-end">
        <Text color={theme.text.secondary}>{tokenStr}</Text>
      </Box>
    </Box>
  );
};

export const ContextUsage: React.FC<ContextUsageProps> = ({
  modelName,
  totalTokens,
  contextWindowSize,
  breakdown,
  toolDetails,
  isEstimated,
  showDetails = false,
  width,
}) => {
  const percentage =
    contextWindowSize > 0 ? (totalTokens / contextWindowSize) * 100 : 0;
  const isOverLimit = percentage > 100;

  // Sort detail items by token count (descending) for better readability
  const sortedTools = [...toolDetails].sort((a, b) => b.tokens - a.tokens);

  return (
    <Box
      borderStyle="round"
      borderColor={theme.border.default}
      flexDirection="column"
      paddingY={1}
      paddingX={2}
      width={width}
    >
      {/* Title */}
      <Text bold color={theme.text.accent}>
        {'Context Usage'}
      </Text>
      <Box height={1} />

      {isEstimated && (
        <Box marginBottom={1}>
          <Text color={theme.status.warning} italic>
            {'No API response yet. Showing estimated usage.'}
          </Text>
        </Box>
      )}

      {/* Model name + context window info */}
      <Box width={CONTENT_WIDTH} marginBottom={1}>
        <Text color={theme.text.secondary}>
          {'Model'}: {modelName}
        </Text>
        <Box flexGrow={1} justifyContent="flex-end">
          <Text color={theme.text.secondary}>
            {'Context window'}: {formatTokens(contextWindowSize)} {'tokens'}
          </Text>
        </Box>
      </Box>
      {/* Progress bar — two segments: used | free */}
      <Box width={CONTENT_WIDTH}>
        <ProgressBar
          usedPercentage={Math.min(percentage, 100)}
          width={CONTENT_WIDTH}
        />
      </Box>
      {/* Warning when context exceeds limit */}
      {isOverLimit && (
        <Box marginBottom={1}>
          <Text color={theme.status.error}>
            {'Context exceeds limit! Use /compress or /clear to reduce.'}
          </Text>
        </Box>
      )}
      <Box height={1} />
      {/* Legend — same layout as CategoryRow for alignment */}
      <CategoryRow
        symbol={FILLED}
        label={'Used'}
        tokens={totalTokens}
        contextWindowSize={contextWindowSize}
        symbolColor={isOverLimit ? theme.status.error : theme.text.accent}
        isOverLimit={isOverLimit}
      />
      <CategoryRow
        symbol={EMPTY}
        label={'Free'}
        tokens={breakdown.freeSpace}
        contextWindowSize={contextWindowSize}
        symbolColor={theme.text.secondary}
      />
      <Box height={1} />

      {/* Breakdown header */}
      <Text bold color={theme.text.primary}>
        {'Usage by category'}
      </Text>

      <CategoryRow
        symbol={FILLED}
        label={'System prompt'}
        tokens={breakdown.systemPrompt}
        contextWindowSize={contextWindowSize}
        symbolColor={theme.text.accent}
      />
      <CategoryRow
        symbol={FILLED}
        label={'Tools'}
        tokens={breakdown.tools}
        contextWindowSize={contextWindowSize}
        symbolColor={theme.text.accent}
      />
      <CategoryRow
        symbol={FILLED}
        label={'History'}
        tokens={breakdown.messages}
        contextWindowSize={contextWindowSize}
        symbolColor={theme.text.accent}
      />

      {showDetails && sortedTools.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={theme.text.primary}>
            {'Tools'}
          </Text>
          {sortedTools.map((tool) => (
            <DetailRow
              key={tool.name}
              name={tool.name}
              tokens={tool.tokens}
            />
          ))}
        </Box>
      )}
      {showDetails && sortedTools.length === 0 && (
        <Box marginTop={1}>
          <Text color={theme.text.secondary} italic>
            {'No per-tool data available.'}
          </Text>
        </Box>
      )}
      {!showDetails && (
        <Box marginTop={1}>
          <Text color={theme.text.secondary} italic>
            {'Run /context detail for per-item breakdown.'}
          </Text>
        </Box>
      )}
    </Box>
  );
};
