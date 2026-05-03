/**
 * /tasks — 查看后台任务列表
 *
 * 用法：
 *   /tasks         — 显示活跃任务（非 done）
 *   /tasks all     — 显示所有任务（含已完成、失败）
 *   /tasks clear   — 清除已完成的任务记录
 */

import type { SlashCommand, CommandContext, MessageActionReturn } from './types.js';
import { CommandKind } from './types.js';
import { AniTaskManager } from '../../ani/taskManager.js';
import type { TaskMeta } from '../../ani/taskManager.js';

/** 状态图标 */
function statusIcon(status: TaskMeta['status']): string {
  const icons: Record<string, string> = {
    pending: '○',
    running: '⟳',
    done: '✓',
    failed: '✗',
  };
  return icons[status] ?? '?';
}

/** 状态标签 */
function statusLabel(status: TaskMeta['status']): string {
  const labels: Record<string, string> = {
    pending: '等待中',
    running: '进行中',
    done: '完成',
    failed: '失败',
  };
  return labels[status] ?? status;
}

/** 计算相对时间 */
function relativeTime(isoStr: string): string {
  const now = Date.now();
  const then = new Date(isoStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}小时前`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}天前`;
}

function renderTaskList(tasks: TaskMeta[], showAll: boolean): string {
  if (tasks.length === 0) {
    return showAll ? '暂无后台任务' : '暂无活跃后台任务\n提示：使用 /tasks all 查看所有历史任务';
  }

  const lines: string[] = ['后台任务状态', ''];

  for (const t of tasks) {
    const icon = statusIcon(t.status);
    const label = statusLabel(t.status);
    const progress = t.status === 'running' ? `  ${Math.round(t.progress * 100)}%` : '';
    const eta = t.eta_seconds && t.status === 'running' ? `  约 ${Math.ceil(t.eta_seconds / 60)} 分钟` : '';
    const time = t.status === 'done' || t.status === 'failed'
      ? `  (${relativeTime(t.updated_at)})`
      : '';
    const error = t.status === 'failed' && t.error ? `  ${t.error.message.slice(0, 40)}` : '';

    lines.push(`${icon} ${t.name}  ${label}${progress}${eta}${time}${error}`);
  }

  lines.push('');
  if (!showAll) {
    lines.push('输入 /tasks all 查看所有任务（含已完成）');
  } else {
    lines.push('输入 /tasks clear 清除已完成的任务记录');
  }

  return lines.join('\n');
}

export const tasksCommand: SlashCommand = {
  name: 'tasks',
  altNames: ['task'],
  description: '查看后台任务列表（/tasks all 查看全部）',
  kind: CommandKind.BUILT_IN,
  action: async (
    _context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn> => {
    const trimmed = args.trim();

    // /tasks clear — 清除已完成任务
    if (trimmed === 'clear') {
      try {
        const taskManager = new AniTaskManager();
        const allTasks = await taskManager.listTasks();
        const doneTasks = allTasks.filter(t => t.status === 'done');
        // 清除操作：暂不支持删除，只返回提示
        return {
          type: 'message',
          messageType: 'info',
          content: `共 ${doneTasks.length} 个已完成任务（清除功能待实现）`,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          type: 'message',
          messageType: 'error',
          content: `无法获取任务列表：${msg}`,
        };
      }
    }

    const showAll = trimmed === 'all';

    try {
      const taskManager = new AniTaskManager();
      const allTasks = await taskManager.listTasks();

      // 默认只显示非 done 的任务
      const tasks = showAll ? allTasks : allTasks.filter(t => t.status !== 'done');
      const text = renderTaskList(tasks, showAll);

      return {
        type: 'message',
        messageType: 'info',
        content: text,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        type: 'message',
        messageType: 'error',
        content: `无法获取任务列表：${msg}`,
      };
    }
  },
};
