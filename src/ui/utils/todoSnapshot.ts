/**
 * @license
 * Copyright 2025 Qwen Code
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Sticky todo panel snapshot extraction.
 *
 * Extracts the latest TodoWrite result from history so the sticky "Current
 * tasks" footer panel can render it while the inline result has scrolled out
 * of view.
 *
 * Fused from qwen-code src/ui/utils/todoSnapshot.ts; alice adaptation:
 * the todo tool's status union includes 'cancelled' (qwen does not), which is
 * normalized to 'completed' during extraction because the UI TodoItem type
 * only models pending/in_progress/completed.
 */

import type { TodoItem } from '../components/TodoDisplay.js';
import type {
  HistoryItem,
  HistoryItemWithoutId,
  IndividualToolCallDisplay,
} from '../types.js';

type HistoryLikeItem = HistoryItem | HistoryItemWithoutId;
interface TodoSnapshotSearchResult {
  itemIndex: number;
  todos: TodoItem[] | null;
}

type SnapshotSearchResult = TodoSnapshotSearchResult | undefined;

// This threshold is item-count based, not line-count based. A single long
// response can fill the viewport while still counting as one item, so the
// sticky panel may stay hidden longer than strictly necessary. That is
// preferable to duplicating a recently committed inline TodoWrite result.
// On tall terminals, TodoWrite -> short text -> small tool call can still
// leave the inline result visible when the sticky panel appears.
const MIN_HISTORY_ITEMS_AFTER_TODO_BEFORE_STICKY = 2;
export const STICKY_TODO_MAX_VISIBLE_ITEMS = 5;
const STICKY_TODO_ROWS_PER_VISIBLE_ITEM = 5;

const STICKY_TODO_STATUS_PRIORITY: Record<TodoItem['status'], number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
};

function clampStickyTodoVisibleItems(value: number): number {
  if (!Number.isFinite(value)) {
    return STICKY_TODO_MAX_VISIBLE_ITEMS;
  }

  return Math.max(
    1,
    Math.min(STICKY_TODO_MAX_VISIBLE_ITEMS, Math.floor(value)),
  );
}

/**
 * Normalize a raw todo (whose status may include alice's 'cancelled') into
 * the UI TodoItem shape. Unknown statuses map to 'pending'.
 */
function normalizeTodo(raw: Record<string, unknown>): TodoItem | null {
  const id = raw['id'];
  const content = raw['content'];
  const status = raw['status'];
  if (typeof id !== 'string' || typeof content !== 'string') {
    return null;
  }
  let normalizedStatus: TodoItem['status'];
  if (
    status === 'pending' ||
    status === 'in_progress' ||
    status === 'completed'
  ) {
    normalizedStatus = status;
  } else {
    // alice adaptation: 'cancelled' (and any unknown) renders as completed
    // (strikethrough, lowest sticky priority).
    normalizedStatus = 'completed';
  }
  return { id, content, status: normalizedStatus };
}

function extractTodosFromResultDisplay(
  resultDisplay: unknown,
): TodoItem[] | null {
  if (!resultDisplay) {
    return null;
  }

  if (typeof resultDisplay === 'object') {
    const candidate = resultDisplay as Record<string, unknown>;
    if (
      candidate['type'] === 'todo_list' &&
      Array.isArray(candidate['todos'])
    ) {
      return candidate['todos']
        .map((raw) =>
          normalizeTodo(
            typeof raw === 'object' && raw !== null
              ? (raw as Record<string, unknown>)
              : {},
          ),
        )
        .filter((todo): todo is TodoItem => todo !== null);
    }
  }

  if (typeof resultDisplay === 'string') {
    try {
      const parsed = JSON.parse(resultDisplay) as Record<string, unknown>;
      if (parsed['type'] === 'todo_list' && Array.isArray(parsed['todos'])) {
        return parsed['todos']
          .map((raw) =>
            normalizeTodo(
              typeof raw === 'object' && raw !== null
                ? (raw as Record<string, unknown>)
                : {},
            ),
          )
          .filter((todo): todo is TodoItem => todo !== null);
      }
    } catch {
      return null;
    }
  }

  return null;
}

function findLatestTodoSnapshot(
  items: readonly HistoryLikeItem[],
): SnapshotSearchResult {
  for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
    const item = items[itemIndex];
    if (item.type !== 'tool_group') {
      continue;
    }

    for (
      let toolIndex = item.tools.length - 1;
      toolIndex >= 0;
      toolIndex -= 1
    ) {
      const tool = item.tools[toolIndex] as IndividualToolCallDisplay;
      const todos = extractTodosFromResultDisplay(tool.resultDisplay);
      if (todos) {
        return {
          itemIndex,
          todos: todos.length > 0 ? todos : null,
        };
      }
    }
  }

  return undefined;
}

function areAllTodosCompleted(todos: readonly TodoItem[]): boolean {
  return todos.length > 0 && todos.every((todo) => todo.status === 'completed');
}

function isRecentHistoryTodoSnapshot(
  snapshotItemIndex: number,
  historyLength: number,
): boolean {
  const historyItemsAfterSnapshot = historyLength - snapshotItemIndex - 1;
  return historyItemsAfterSnapshot < MIN_HISTORY_ITEMS_AFTER_TODO_BEFORE_STICKY;
}

export function getStickyTodos(
  history: readonly HistoryItem[],
  pendingHistoryItems: readonly HistoryItemWithoutId[],
): TodoItem[] | null {
  const pendingSnapshot = findLatestTodoSnapshot(pendingHistoryItems);
  if (pendingSnapshot !== undefined) {
    // The pending TodoWrite result is already rendered inline above the
    // composer, so defer the sticky panel until the turn commits to history.
    return null;
  }

  const historySnapshot = findLatestTodoSnapshot(history);
  if (historySnapshot === undefined || historySnapshot.todos === null) {
    return null;
  }

  // Ink Static writes committed history to scrollback, and does not expose a
  // reliable per-item viewport API. Treat very recent TodoWrite snapshots as
  // still visible so the footer does not duplicate the inline result.
  if (isRecentHistoryTodoSnapshot(historySnapshot.itemIndex, history.length)) {
    return null;
  }

  if (areAllTodosCompleted(historySnapshot.todos)) {
    return null;
  }

  return historySnapshot.todos;
}

export function getOrderedStickyTodos(todos: readonly TodoItem[]): TodoItem[] {
  return todos
    .map((todo, index) => ({ todo, index }))
    .sort(
      (left, right) =>
        STICKY_TODO_STATUS_PRIORITY[left.todo.status] -
          STICKY_TODO_STATUS_PRIORITY[right.todo.status] ||
        left.index - right.index,
    )
    .map(({ todo }) => todo);
}

export function getStickyTodosRenderKey(
  todos: readonly TodoItem[] | null,
): string {
  if (!todos) {
    return 'null';
  }

  return JSON.stringify(
    todos.map((todo) => [todo.id, todo.content, todo.status]),
  );
}

export function getStickyTodosLayoutKey(
  todos: readonly TodoItem[] | null,
  width: number,
  maxVisibleItems: number,
): string {
  if (!todos) {
    return 'null';
  }

  const visibleTodoCount = clampStickyTodoVisibleItems(maxVisibleItems);
  const visibleTodos = todos.slice(0, visibleTodoCount);
  const hasHiddenTodos = todos.length > visibleTodos.length;

  return JSON.stringify({
    width,
    maxVisibleItems: visibleTodoCount,
    hasHiddenTodos,
    todos: visibleTodos.map((todo) => [todo.id, todo.content]),
  });
}

export function getStickyTodoMaxVisibleItems(terminalHeight: number): number {
  if (!Number.isFinite(terminalHeight) || terminalHeight <= 0) {
    return STICKY_TODO_MAX_VISIBLE_ITEMS;
  }

  return clampStickyTodoVisibleItems(
    terminalHeight / STICKY_TODO_ROWS_PER_VISIBLE_ITEM,
  );
}
