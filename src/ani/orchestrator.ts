/**
 * Orchestrator — 任务编排器
 *
 * 职责：接收任务，执行子任务链，处理重试。
 * fire-and-forget：调用方不 await 结果。
 */

import { AniTaskManager } from './taskManager.js';
import type { TaskMeta, SubtaskMeta } from './taskManager.js';
import type { AniSettings } from './settings.js';
import { runSubAgentWithFallback, classifyError } from './subAgentRunner.js';

export class Orchestrator {
  constructor(
    private taskManager: AniTaskManager,
    private settings: AniSettings,
  ) {}

  /**
   * 接收一个已创建的 task，开始执行。
   * fire-and-forget：调用方不 await 结果。
   */
  async execute(taskId: string): Promise<void> {
    try {
      const task = await this.taskManager.getTask(taskId);
      if (!task) return;

      await this.taskManager.updateTask(taskId, { status: 'running' });
      await this.taskManager.appendLog(taskId, `任务开始执行，共 ${task.subtasks.length} 个子任务`);

      // 按依赖关系串行执行
      while (true) {
        const currentTask = await this.taskManager.getTask(taskId);
        if (!currentTask || currentTask.status === 'failed') break;

        // 找到下一个可执行的 subtask
        const nextSubtask = this.findNextSubtask(currentTask);
        if (!nextSubtask) {
          // 检查是否全部完成
          const allDone = currentTask.subtasks.every(s => s.status === 'done');
          if (allDone) {
            await this.taskManager.updateTask(taskId, { status: 'done' });
            await this.taskManager.signalDone(taskId);
            await this.taskManager.appendLog(taskId, '任务完成');
          } else {
            // 有 subtask 未完成但无法执行（死锁或失败）
            await this.taskManager.updateTask(taskId, {
              status: 'failed',
              error: { type: 'non-retryable', message: '子任务依赖无法满足' },
            });
            await this.taskManager.signalFailed(taskId, '子任务依赖无法满足');
            await this.taskManager.appendLog(taskId, '任务失败：子任务依赖无法满足');
          }
          break;
        }

        // 执行子任务
        await this.executeSubtask(taskId, nextSubtask, currentTask);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await this.taskManager.updateTask(taskId, {
          status: 'failed',
          error: { type: 'non-retryable', message: msg },
        });
        await this.taskManager.signalFailed(taskId, msg);
        await this.taskManager.appendLog(taskId, `任务异常终止：${msg}`);
      } catch { /* 最终兜底 */ }
    }
  }

  /**
   * 找到下一个可执行的 subtask（depends_on 全部 done 的 pending subtask）
   */
  private findNextSubtask(task: TaskMeta): SubtaskMeta | null {
    return task.subtasks.find(s => {
      if (s.status !== 'pending') return false;
      return s.depends_on.every(depId => {
        const dep = task.subtasks.find(d => d.id === depId);
        return dep?.status === 'done';
      });
    }) ?? null;
  }

  /**
   * 执行单个子任务，含重试逻辑
   */
  private async executeSubtask(taskId: string, subtask: SubtaskMeta, task: TaskMeta): Promise<void> {
    await this.taskManager.updateSubtask(taskId, subtask.id, 'running');
    await this.taskManager.appendLog(taskId, `开始执行子任务: ${subtask.id}`);

    // 读取 input.md 作为 prompt
    const inputContent = await this.taskManager.readSubtaskInput(taskId, subtask.id);
    if (!inputContent) {
      await this.taskManager.updateSubtask(taskId, subtask.id, 'failed');
      await this.taskManager.appendLog(taskId, `子任务 ${subtask.id} 缺少 input.md`);
      await this.taskManager.updateTask(taskId, {
        status: 'failed',
        error: { type: 'non-retryable', message: `子任务 ${subtask.id} 缺少 input.md` },
      });
      await this.taskManager.signalFailed(taskId, `子任务 ${subtask.id} 缺少 input.md`);
      return;
    }

    let prompt = inputContent;
    let retryCount = 0;
    const retryMax = task.retry_max;

    while (retryCount <= retryMax) {
      // 调用 SubAgentRunner（带降级）
      const result = await runSubAgentWithFallback(
        {
          prompt,
          workDir: task.work_dir,
          sessionId: taskId,
        },
        this.settings,
      );

      // 写入 output.md
      await this.taskManager.writeSubtaskOutput(taskId, subtask.id, result.stdout);

      if (result.success) {
        await this.taskManager.updateSubtask(taskId, subtask.id, 'done');
        await this.taskManager.appendLog(taskId, `子任务 ${subtask.id} 完成 (${result.durationMs}ms)`);
        return;
      }

      // 失败处理
      const errorType = classifyError(result);
      retryCount++;

      await this.taskManager.appendLog(taskId,
        `子任务 ${subtask.id} 失败 (${errorType})，第 ${retryCount} 次尝试`);

      if (errorType === 'non-retryable' || retryCount > retryMax) {
        await this.taskManager.updateSubtask(taskId, subtask.id, 'failed');
        await this.taskManager.updateTask(taskId, {
          status: 'failed',
          error: {
            type: errorType,
            message: result.stderr.slice(0, 500),
            stderr: result.stderr,
          },
        });
        await this.taskManager.signalFailed(taskId, result.stderr.slice(0, 200));
        await this.taskManager.appendLog(taskId, `子任务 ${subtask.id} 最终失败 (${errorType})`);
        return;
      }

      // 重试时带上次 output 作上下文
      const lastOutput = await this.taskManager.readSubtaskOutput(taskId, subtask.id);
      prompt = `上次尝试的输出（失败）：\n---\n${lastOutput ?? ''}\n---\n请基于以上信息重新尝试：${inputContent}`;
    }
  }
}
