/**
 * dispatchTask 工具 — 老管家委托后台任务的入口
 *
 * 工具名：dispatch_task
 * 老管家在判断某件事可以委托时调用此工具。
 */

import type { AniTool, ToolResult } from '../../types/tool.js';
import { AniTaskManager } from '../../ani/taskManager.js';
import { Orchestrator } from '../../ani/orchestrator.js';
import { loadAniSettings } from '../../ani/settings.js';
import { getErrorMessage } from '../../utils/error.js';

// 单例 taskManager 和 orchestrator
let _taskManager: AniTaskManager | null = null;
let _orchestrator: Orchestrator | null = null;

export function getTaskManager(): AniTaskManager {
  if (!_taskManager) {
    _taskManager = new AniTaskManager();
  }
  return _taskManager;
}

function getOrchestrator(): Orchestrator {
  if (!_orchestrator) {
    const settings = loadAniSettings();
    _orchestrator = new Orchestrator(getTaskManager(), settings);
  }
  return _orchestrator;
}

export const dispatchTaskTool: AniTool = {
  name: 'dispatch_task',
  label: '委托后台任务',
  description: '将一个可委托的任务派给后台执行。老管家在判断某件事可以异步处理时调用此工具。任务会在后台由 sub-agent 执行，完成后老管家会播报结果。',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: '任务名（用于 TUI 显示和用户播报）',
      },
      type: {
        type: 'string',
        enum: ['code-fix', 'doc-write', 'generic'],
        description: '任务类型',
      },
      subtasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '子任务 ID，格式：01-step-name' },
            description: { type: 'string', description: '给 sub-agent 的完整指令' },
            depends_on: {
              type: 'array',
              items: { type: 'string' },
              description: '依赖的子任务 ID 列表',
            },
          },
          required: ['id', 'description', 'depends_on'],
        },
        description: '子任务列表',
      },
      work_dir: {
        type: 'string',
        description: '工作目录（默认当前工作目录）',
      },
    },
    required: ['name', 'type', 'subtasks'],
  },

  async execute(
    _toolCallId: string,
    params: any,
    _signal: AbortSignal,
    context?: any,
  ): Promise<ToolResult> {
    try {
      const taskManager = getTaskManager();
      const orchestrator = getOrchestrator();

      const taskId = await taskManager.createTask({
        name: params.name,
        type: params.type,
        subtasks: params.subtasks,
        workDir: params.work_dir ?? context?.workspace ?? process.cwd(),
      });

      // fire-and-forget：不 await
      orchestrator.execute(taskId).catch(err => {
        console.error(`Orchestrator error for ${taskId}:`, err);
      });

      return {
        success: true,
        data: {
          task_id: taskId,
          message: `任务已派出，ID: ${taskId}。老管家会在任务完成后播报结果。`,
        },
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `委托任务失败: ${getErrorMessage(error)}`,
      };
    }
  },
};
