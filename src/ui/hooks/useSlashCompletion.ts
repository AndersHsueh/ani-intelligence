/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo } from 'react';
import { AsyncFzf } from 'fzf';
import { createDebugLogger } from '@qwen-code/qwen-code-core';
import type { FzfResultItem } from 'fzf';
import type { Suggestion } from '../components/SuggestionsDisplay.js';
import {
  CommandKind,
  type CommandCompletionItem,
  type CommandContext,
  type SlashCommand,
} from '../commands/types.js';

// Type alias for improved type safety based on actual fzf result structure
type FzfCommandResult = FzfResultItem<string>;

// Interface for FZF command cache entry
interface FzfCommandCacheEntry {
  fzf: AsyncFzf<string[]>;
  commandMap: Map<string, SlashCommand>;
}

const debugLogger = createDebugLogger('SLASH_COMPLETION');

// Utility function to safely handle errors without information disclosure
function logErrorSafely(error: unknown, context: string): void {
  if (error instanceof Error) {
    // Log full error details securely for debugging
    debugLogger.error(`[${context}]`, error);
  } else {
    debugLogger.error(`[${context}] Non-error thrown:`, error);
  }
}

// Shared utility function for command matching logic
function matchesCommand(cmd: SlashCommand, query: string): boolean {
  return (
    cmd.name.toLowerCase() === query.toLowerCase() ||
    cmd.altNames?.some((alt) => alt.toLowerCase() === query.toLowerCase()) ||
    false
  );
}

// ── Completion ranking (fused from qwen-code, alice-adapted contract) ──

/**
 * Match priority tiers for slash-command completion.
 * Higher value = stronger match. Strictly decreasing:
 * EXACT > PREFIX > SEGMENT_PREFIX > FUZZY.
 */
export const COMPLETION_PRIORITY = {
  /** Command name equals the query exactly (case-insensitive) */
  EXACT: 9000,
  /** Command name (or an altName) starts with the query */
  PREFIX: 8000,
  /**
   * Every query character lands, in order, on a segment-start position of
   * the name (position 0 or right after a non-alphanumeric separator),
   * e.g. query "st" hits "set-token" (s@0, t after '-').
   */
  SEGMENT_PREFIX: 7000,
  /** Query characters appear in order within the name (subsequence) */
  FUZZY: 6000,
} as const;

export type CompletionPriority =
  (typeof COMPLETION_PRIORITY)[keyof typeof COMPLETION_PRIORITY];

/** Strip a leading slash and lowercase (queries may arrive as "/he"). */
function normalizeCompletionQuery(query: string): string {
  return (query.startsWith('/') ? query.slice(1) : query).toLowerCase();
}

/**
 * Normalize a command name for matching. A leading slash on the command
 * name is stripped but NOT treated as a segment boundary.
 */
function normalizeCompletionName(name: string): string {
  return (name.startsWith('/') ? name.slice(1) : name).toLowerCase();
}

function isSegmentStart(name: string, index: number): boolean {
  if (index === 0) {
    return true;
  }
  const prev = name[index - 1] ?? '';
  return !/[a-z0-9]/.test(prev);
}

/** Acronym-style match: each query char hits a segment start, in order. */
function isSegmentPrefixMatch(name: string, query: string): boolean {
  let qi = 0;
  for (let i = 0; i < name.length && qi < query.length; i++) {
    if (isSegmentStart(name, i) && name[i] === query[qi]) {
      qi++;
    }
  }
  return qi === query.length;
}

/** Subsequence match: query chars appear in order within name. */
function isSubsequenceMatch(name: string, query: string): boolean {
  let qi = 0;
  for (let i = 0; i < name.length && qi < query.length; i++) {
    if (name[i] === query[qi]) {
      qi++;
    }
  }
  return qi === query.length;
}

/**
 * Best match priority for a command against a query, or undefined when the
 * command does not match at all. The canonical name is preferred: an exact
 * altName hit ranks at PREFIX (only the canonical name can be EXACT).
 */
export function getCompletionPriority(
  cmd: Pick<SlashCommand, 'name' | 'altNames'>,
  query: string,
): CompletionPriority | undefined {
  const q = normalizeCompletionQuery(query);
  if (!q) {
    return undefined;
  }
  const name = normalizeCompletionName(cmd.name);
  const alts = (cmd.altNames ?? []).map(normalizeCompletionName);

  if (name === q) {
    return COMPLETION_PRIORITY.EXACT;
  }
  if (name.startsWith(q) || alts.some((a) => a.startsWith(q))) {
    return COMPLETION_PRIORITY.PREFIX;
  }
  if (
    isSegmentPrefixMatch(name, q) ||
    alts.some((a) => isSegmentPrefixMatch(a, q))
  ) {
    return COMPLETION_PRIORITY.SEGMENT_PREFIX;
  }
  if (
    isSubsequenceMatch(name, q) ||
    alts.some((a) => isSubsequenceMatch(a, q))
  ) {
    return COMPLETION_PRIORITY.FUZZY;
  }
  return undefined;
}

/**
 * Numeric match strength usable directly in sort comparators.
 * Returns -1 when the command does not match the query.
 */
export function getCommandMatchStrength(
  cmd: Pick<SlashCommand, 'name' | 'altNames'>,
  query: string,
): number {
  return getCompletionPriority(cmd, query) ?? -1;
}

/**
 * Sort key for completion suggestions: strength descending, ties broken by
 * command name ascending (stable and deterministic).
 */
export function completionKey(
  cmd: Pick<SlashCommand, 'name' | 'altNames'>,
  query: string,
): { strength: number; name: string } {
  return { strength: getCommandMatchStrength(cmd, query), name: cmd.name };
}

interface CommandParserResult {
  hasTrailingSpace: boolean;
  commandPathParts: string[];
  partial: string;
  currentLevel: readonly SlashCommand[] | undefined;
  leafCommand: SlashCommand | null;
  exactMatchAsParent: SlashCommand | undefined;
  isArgumentCompletion: boolean;
}

function useCommandParser(
  query: string | null,
  slashCommands: readonly SlashCommand[],
): CommandParserResult {
  return useMemo(() => {
    if (!query) {
      return {
        hasTrailingSpace: false,
        commandPathParts: [],
        partial: '',
        currentLevel: slashCommands,
        leafCommand: null,
        exactMatchAsParent: undefined,
        isArgumentCompletion: false,
      };
    }

    const fullPath = query.substring(1) || '';
    const hasTrailingSpace = !!query.endsWith(' ');
    const rawParts = fullPath.split(/\s+/).filter((p) => p);
    let commandPathParts = rawParts;
    let partial = '';

    if (!hasTrailingSpace && rawParts.length > 0) {
      partial = rawParts[rawParts.length - 1];
      commandPathParts = rawParts.slice(0, -1);
    }

    let currentLevel: readonly SlashCommand[] | undefined = slashCommands;
    let leafCommand: SlashCommand | null = null;

    for (const part of commandPathParts) {
      if (!currentLevel) {
        leafCommand = null;
        currentLevel = [];
        break;
      }
      const found: SlashCommand | undefined = currentLevel.find((cmd) =>
        matchesCommand(cmd, part),
      );

      if (found) {
        leafCommand = found;
        currentLevel = found.subCommands as readonly SlashCommand[] | undefined;
        if (found.kind === CommandKind.MCP_PROMPT) {
          break;
        }
      } else {
        leafCommand = null;
        currentLevel = [];
        break;
      }
    }

    let exactMatchAsParent: SlashCommand | undefined;
    if (!hasTrailingSpace && currentLevel) {
      exactMatchAsParent = currentLevel.find(
        (cmd) => matchesCommand(cmd, partial) && cmd.subCommands,
      );

      if (exactMatchAsParent) {
        leafCommand = exactMatchAsParent;
        currentLevel = exactMatchAsParent.subCommands;
        partial = '';
      }
    }

    const depth = commandPathParts.length;
    const isArgumentCompletion = !!(
      leafCommand?.completion &&
      (hasTrailingSpace ||
        (rawParts.length > depth && depth > 0 && partial !== ''))
    );

    return {
      hasTrailingSpace,
      commandPathParts,
      partial,
      currentLevel,
      leafCommand,
      exactMatchAsParent,
      isArgumentCompletion,
    };
  }, [query, slashCommands]);
}

interface SuggestionsResult {
  suggestions: Suggestion[];
  isLoading: boolean;
}

interface CompletionPositions {
  start: number;
  end: number;
}

interface PerfectMatchResult {
  isPerfectMatch: boolean;
}

function useCommandSuggestions(
  parserResult: CommandParserResult,
  commandContext: CommandContext,
  getFzfForCommands: (
    commands: readonly SlashCommand[],
  ) => FzfCommandCacheEntry | null,
  getPrefixSuggestions: (
    commands: readonly SlashCommand[],
    partial: string,
  ) => SlashCommand[],
): SuggestionsResult {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const abortController = new AbortController();
    const { signal } = abortController;

    const {
      isArgumentCompletion,
      leafCommand,
      commandPathParts,
      partial,
      currentLevel,
    } = parserResult;

    if (isArgumentCompletion) {
      const fetchAndSetSuggestions = async () => {
        if (signal.aborted) return;

        // Safety check: ensure leafCommand and completion exist
        if (!leafCommand?.completion) {
          debugLogger.warn(
            'Attempted argument completion without completion function',
          );
          return;
        }

        setIsLoading(true);
        try {
          const rawParts = [...commandPathParts];
          if (partial) rawParts.push(partial);
          const depth = commandPathParts.length;
          const argString = rawParts.slice(depth).join(' ');
          const results =
            (await leafCommand.completion(
              {
                ...commandContext,
                invocation: {
                  raw: `/${rawParts.join(' ')}`,
                  name: leafCommand.name,
                  args: argString,
                },
              },
              argString,
            )) || [];

          if (!signal.aborted) {
            const finalSuggestions = results
              .map((item) => toSuggestion(item))
              .filter((suggestion): suggestion is Suggestion => !!suggestion);
            setSuggestions(finalSuggestions);
            setIsLoading(false);
          }
        } catch (error) {
          if (!signal.aborted) {
            logErrorSafely(error, 'Argument completion');
            setSuggestions([]);
            setIsLoading(false);
          }
        }
      };
      fetchAndSetSuggestions();
      return () => abortController.abort();
    }

    const commandsToSearch = currentLevel || [];
    if (commandsToSearch.length > 0) {
      const performFuzzySearch = async () => {
        if (signal.aborted) return;
        let potentialSuggestions: SlashCommand[] = [];

        if (partial === '') {
          // If no partial query, show all available commands
          potentialSuggestions = commandsToSearch.filter(
            (cmd) => cmd.description && !cmd.hidden,
          );
        } else {
          // Use fuzzy search for non-empty partial queries with fallback
          const fzfInstance = getFzfForCommands(commandsToSearch);
          if (fzfInstance) {
            try {
              const fzfResults = await fzfInstance.fzf.find(partial);
              if (signal.aborted) return;
              const uniqueCommands = new Set<SlashCommand>();
              fzfResults.forEach((result: FzfCommandResult) => {
                const cmd = fzfInstance.commandMap.get(result.item);
                if (cmd && cmd.description) {
                  uniqueCommands.add(cmd);
                }
              });
              potentialSuggestions = Array.from(uniqueCommands);
            } catch (error) {
              logErrorSafely(
                error,
                'Fuzzy search - falling back to prefix matching',
              );
              // Fallback to prefix-based filtering
              potentialSuggestions = getPrefixSuggestions(
                commandsToSearch,
                partial,
              );
            }
          } else {
            // Fallback to prefix-based filtering when fzf instance creation fails
            potentialSuggestions = getPrefixSuggestions(
              commandsToSearch,
              partial,
            );
          }
        }

        if (!signal.aborted) {
          // Rank suggestions: EXACT > PREFIX > SEGMENT_PREFIX > FUZZY, ties
          // broken by name ascending (e.g. "/he" → help before hooks).
          const rankedSuggestions = potentialSuggestions
            .map((cmd) => ({ cmd, key: completionKey(cmd, partial) }))
            .filter((r) => r.key.strength >= 0)
            .sort(
              (a, b) =>
                b.key.strength - a.key.strength ||
                (a.key.name < b.key.name
                  ? -1
                  : a.key.name > b.key.name
                    ? 1
                    : 0),
            )
            .map((r) => r.cmd);

          const finalSuggestions = rankedSuggestions.map((cmd) => ({
            label: formatSlashCommandLabel(cmd),
            value: cmd.name,
            description: cmd.description,
            commandKind: cmd.kind,
          }));

          setSuggestions(finalSuggestions);
        }
      };

      performFuzzySearch().catch((error) => {
        logErrorSafely(error, 'Unexpected fuzzy search error');
        if (!signal.aborted) {
          // Ultimate fallback: show no suggestions rather than confusing the user
          // with all available commands when their query clearly doesn't match anything
          setSuggestions([]);
        }
      });
      return () => abortController.abort();
    }

    setSuggestions([]);
    return () => abortController.abort();
  }, [parserResult, commandContext, getFzfForCommands, getPrefixSuggestions]);

  return { suggestions, isLoading };
}

function toSuggestion(item: string | CommandCompletionItem): Suggestion | null {
  if (typeof item === 'string') {
    return { label: item, value: item };
  }
  if (!item.value) {
    return null;
  }
  return {
    label: item.label ?? item.value,
    value: item.value,
    description: item.description,
  };
}

function useCompletionPositions(
  query: string | null,
  parserResult: CommandParserResult,
): CompletionPositions {
  return useMemo(() => {
    if (!query) {
      return { start: -1, end: -1 };
    }

    const { hasTrailingSpace, partial, exactMatchAsParent } = parserResult;

    // Set completion start/end positions
    if (hasTrailingSpace || exactMatchAsParent) {
      return { start: query.length, end: query.length };
    } else if (partial) {
      if (parserResult.isArgumentCompletion) {
        const commandSoFar = `/${parserResult.commandPathParts.join(' ')}`;
        const argStartIndex =
          commandSoFar.length +
          (parserResult.commandPathParts.length > 0 ? 1 : 0);
        return { start: argStartIndex, end: query.length };
      } else {
        return { start: query.length - partial.length, end: query.length };
      }
    } else {
      return { start: 1, end: query.length };
    }
  }, [query, parserResult]);
}

function usePerfectMatch(
  parserResult: CommandParserResult,
): PerfectMatchResult {
  return useMemo(() => {
    const { hasTrailingSpace, partial, leafCommand, currentLevel } =
      parserResult;

    if (hasTrailingSpace) {
      return { isPerfectMatch: false };
    }

    if (leafCommand && partial === '' && leafCommand.action) {
      return { isPerfectMatch: true };
    }

    if (currentLevel) {
      const perfectMatch = currentLevel.find(
        (cmd) => matchesCommand(cmd, partial) && cmd.action,
      );
      if (perfectMatch) {
        return { isPerfectMatch: true };
      }
    }

    return { isPerfectMatch: false };
  }, [parserResult]);
}

export interface UseSlashCompletionProps {
  enabled: boolean;
  query: string | null;
  slashCommands: readonly SlashCommand[];
  commandContext: CommandContext;
  setSuggestions: (suggestions: Suggestion[]) => void;
  setIsLoadingSuggestions: (isLoading: boolean) => void;
  setIsPerfectMatch: (isMatch: boolean) => void;
}

export function useSlashCompletion(props: UseSlashCompletionProps): {
  completionStart: number;
  completionEnd: number;
} {
  const {
    enabled,
    query,
    slashCommands,
    commandContext,
    setSuggestions,
    setIsLoadingSuggestions,
    setIsPerfectMatch,
  } = props;
  const [completionStart, setCompletionStart] = useState(-1);
  const [completionEnd, setCompletionEnd] = useState(-1);

  // Simplified cache for AsyncFzf instances - WeakMap handles automatic cleanup
  const fzfInstanceCache = useMemo(
    () => new WeakMap<readonly SlashCommand[], FzfCommandCacheEntry>(),
    [],
  );

  // Helper function to create or retrieve cached AsyncFzf instance for a command level
  const getFzfForCommands = useMemo(
    () => (commands: readonly SlashCommand[]) => {
      if (!commands || commands.length === 0) {
        return null;
      }

      // Check if we already have a cached instance
      const cached = fzfInstanceCache.get(commands);
      if (cached) {
        return cached;
      }

      // Create new fzf instance
      const commandItems: string[] = [];
      const commandMap = new Map<string, SlashCommand>();

      commands.forEach((cmd) => {
        if (cmd.description && !cmd.hidden) {
          commandItems.push(cmd.name);
          commandMap.set(cmd.name, cmd);

          if (cmd.altNames) {
            cmd.altNames.forEach((alt) => {
              commandItems.push(alt);
              commandMap.set(alt, cmd);
            });
          }
        }
      });

      if (commandItems.length === 0) {
        return null;
      }

      try {
        const instance: FzfCommandCacheEntry = {
          fzf: new AsyncFzf(commandItems, {
            fuzzy: 'v2',
            casing: 'case-insensitive', // Explicitly enforce case-insensitivity
          }),
          commandMap,
        };

        // Cache the instance - WeakMap will handle automatic cleanup
        fzfInstanceCache.set(commands, instance);

        return instance;
      } catch (error) {
        logErrorSafely(error, 'FZF instance creation');
        return null;
      }
    },
    [fzfInstanceCache],
  );

  // Memoized helper function for prefix-based filtering to improve performance
  const getPrefixSuggestions = useMemo(
    () => (commands: readonly SlashCommand[], partial: string) =>
      commands.filter(
        (cmd) =>
          cmd.description &&
          !cmd.hidden &&
          (cmd.name.toLowerCase().startsWith(partial.toLowerCase()) ||
            cmd.altNames?.some((alt) =>
              alt.toLowerCase().startsWith(partial.toLowerCase()),
            )),
      ),
    [],
  );

  // Use extracted hooks for better separation of concerns
  const parserResult = useCommandParser(query, slashCommands);
  const { suggestions: hookSuggestions, isLoading } = useCommandSuggestions(
    parserResult,
    commandContext,
    getFzfForCommands,
    getPrefixSuggestions,
  );
  const { start: calculatedStart, end: calculatedEnd } = useCompletionPositions(
    query,
    parserResult,
  );
  const { isPerfectMatch } = usePerfectMatch(parserResult);

  // Clear internal state when disabled
  useEffect(() => {
    if (!enabled) {
      setSuggestions([]);
      setIsLoadingSuggestions(false);
      setIsPerfectMatch(false);
      setCompletionStart(-1);
      setCompletionEnd(-1);
    }
  }, [enabled, setSuggestions, setIsLoadingSuggestions, setIsPerfectMatch]);

  // Update external state only when enabled
  useEffect(() => {
    if (!enabled || query === null) {
      return;
    }

    setSuggestions(hookSuggestions);
    setIsLoadingSuggestions(isLoading);
    setIsPerfectMatch(isPerfectMatch);
    setCompletionStart(calculatedStart);
    setCompletionEnd(calculatedEnd);
  }, [
    enabled,
    query,
    hookSuggestions,
    isLoading,
    isPerfectMatch,
    calculatedStart,
    calculatedEnd,
    setSuggestions,
    setIsLoadingSuggestions,
    setIsPerfectMatch,
  ]);

  return {
    completionStart,
    completionEnd,
  };
}

function formatSlashCommandLabel(command: SlashCommand): string {
  const baseLabel = command.name;
  const altNames = command.altNames?.filter(Boolean);

  if (!altNames || altNames.length === 0) {
    return baseLabel;
  }

  return `${baseLabel} (${altNames.join(', ')})`;
}
