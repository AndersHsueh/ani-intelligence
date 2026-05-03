/**
 * AniTaskManager — 任务 CRUD + 文件持久化
 *
 * 职责：任务的创建、状态管理、文件读写。不负责执行（执行由 Orchestrator 负责）。
 * 文件操作风格对齐 src/onboarding/profileManager.ts
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const ANI_DIR = path.join(os.homedir(), '.ani');

// ── 类型定义 ──

export interface TaskMeta {
  id: string;                    // "task-20250503-001"
  name: string;                  // 人类可读任务名
  type: 'code-fix' | 'doc-write' | 'generic';
  status: 'pending' | 'running' | 'done' | 'failed';
  retry_policy: 'none' | 'on-logic-failure' | 'on-timeout';
  retry_count: number;
  retry_max: number;             // 默认 3
  progress: number;              // 0.0 ~ 1.0
  eta_seconds: number | null;
  created_at: string;            // ISO8601
  updated_at: string;
  work_dir: string;              // 工作目录
  subtasks: SubtaskMeta[];
  error: TaskError | null;
}

export interface SubtaskMeta {
  id: string;                    // "01-step"
  status: 'pending' | 'running' | 'done' | 'failed';
  depends_on: string[];
}

export interface TaskError {
  type: 'non-retryable' | 'retryable-logic' | 'timeout';
  message: string;
  stderr?: string;
}

export interface CreateTaskParams {
  name: string;
  type: TaskMeta['type'];
  subtasks: Array<{
    id: string;
    description: string;       // 给 sub-agent 的完整指令
    depends_on: string[];
  }>;
  workDir?: string;
  retryPolicy?: TaskMeta['retry_policy'];
  retryMax?: number;
}

// ── task-id 生成 ──

function generateTaskId(): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, ''); // "20250503"
  const tasksDir = path.join(ANI_DIR, 'tasks');

  let seq = 1;
  try {
    if (fs.existsSync(tasksDir)) {
      const dirs = fs.readdirSync(tasksDir).filter(d => d.startsWith(`task-${dateStr}-`));
      if (dirs.length > 0) {
        const maxSeq = Math.max(...dirs.map(d => parseInt(d.split('-').pop() || '0', 10)));
        seq = maxSeq + 1;
      }
    }
  } catch { /* 目录不存在，seq = 1 */ }

  return `task-${dateStr}-${String(seq).padStart(3, '0')}`;
}

// ── 辅助函数 ──

function taskDir(taskId: string): string {
  return path.join(ANI_DIR, 'tasks', taskId);
}

function metaPath(taskId: string): string {
  return path.join(taskDir(taskId), 'meta.json');
}

function logPath(taskId: string): string {
  return path.join(taskDir(taskId), 'log.md');
}

function subtaskDir(taskId: string, subtaskId: string): string {
  return path.join(taskDir(taskId), 'subtasks', subtaskId);
}

function inboxDir(): string {
  return path.join(ANI_DIR, 'inbox');
}

function nowISO(): string {
  return new Date().toISOString();
}

// ── AniTaskManager 类 ──

export class AniTaskManager {
  /**
   * 创建新任务，写入 meta.json 和子任务 input.md，返回 task id
   */
  async createTask(params: CreateTaskParams): Promise<string> {
    const taskId = generateTaskId();
    const dir = taskDir(taskId);
    const now = nowISO();

    const meta: TaskMeta = {
      id: taskId,
      name: params.name,
      type: params.type,
      status: 'pending',
      retry_policy: params.retryPolicy ?? 'on-logic-failure',
      retry_count: 0,
      retry_max: params.retryMax ?? 3,
      progress: 0,
      eta_seconds: null,
      created_at: now,
      updated_at: now,
      work_dir: params.workDir ?? process.cwd(),
      subtasks: params.subtasks.map(s => ({
        id: s.id,
        status: 'pending' as const,
        depends_on: s.depends_on,
      })),
      error: null,
    };

    try {
      fs.mkdirSync(path.join(dir, 'subtasks'), { recursive: true });
      fs.writeFileSync(metaPath(taskId), JSON.stringify(meta, null, 2), 'utf-8');
      fs.writeFileSync(logPath(taskId), '', 'utf-8');

      // 为每个子任务创建目录和 input.md
      for (const subtask of params.subtasks) {
        const sDir = subtaskDir(taskId, subtask.id);
        fs.mkdirSync(sDir, { recursive: true });
        fs.writeFileSync(path.join(sDir, 'input.md'), subtask.description, 'utf-8');
      }
    } catch (err) {
      console.error(`[AniTaskManager] createTask failed:`, err);
    }

    return taskId;
  }

  /**
   * 更新任务状态（status, progress, error 等）
   */
  async updateTask(taskId: string, updates: Partial<TaskMeta>): Promise<void> {
    try {
      const meta = await this.getTask(taskId);
      if (!meta) return;

      const updated: TaskMeta = {
        ...meta,
        ...updates,
        updated_at: nowISO(),
      };
      fs.writeFileSync(metaPath(taskId), JSON.stringify(updated, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[AniTaskManager] updateTask failed:`, err);
    }
  }

  /**
   * 更新某个子任务状态，同时重算 progress
   */
  async updateSubtask(taskId: string, subtaskId: string, status: SubtaskMeta['status']): Promise<void> {
    try {
      const meta = await this.getTask(taskId);
      if (!meta) return;

      const subtasks = meta.subtasks.map(s =>
        s.id === subtaskId ? { ...s, status } : s
      );

      // 重算 progress
      const doneCount = subtasks.filter(s => s.status === 'done').length;
      const progress = subtasks.length > 0 ? doneCount / subtasks.length : 0;

      const updated: TaskMeta = {
        ...meta,
        subtasks,
        progress,
        updated_at: nowISO(),
      };
      fs.writeFileSync(metaPath(taskId), JSON.stringify(updated, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[AniTaskManager] updateSubtask failed:`, err);
    }
  }

  /**
   * 读取所有任务（用于 /tasks 命令），按 created_at 倒序
   */
  async listTasks(): Promise<TaskMeta[]> {
    const tasksDir = path.join(ANI_DIR, 'tasks');
    const result: TaskMeta[] = [];

    try {
      if (!fs.existsSync(tasksDir)) return result;

      const dirs = fs.readdirSync(tasksDir);
      for (const dir of dirs) {
        const mp = path.join(tasksDir, dir, 'meta.json');
        try {
          const raw = fs.readFileSync(mp, 'utf-8');
          result.push(JSON.parse(raw) as TaskMeta);
        } catch { /* 跳过无法读取的 */ }
      }
    } catch (err) {
      console.error(`[AniTaskManager] listTasks failed:`, err);
    }

    return result.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  /**
   * 读取单个任务
   */
  async getTask(taskId: string): Promise<TaskMeta | null> {
    try {
      const mp = metaPath(taskId);
      if (!fs.existsSync(mp)) return null;
      const raw = fs.readFileSync(mp, 'utf-8');
      return JSON.parse(raw) as TaskMeta;
    } catch (err) {
      console.error(`[AniTaskManager] getTask failed:`, err);
      return null;
    }
  }

  /**
   * 追加写 log.md
   */
  async appendLog(taskId: string, line: string): Promise<void> {
    try {
      const lp = logPath(taskId);
      const timestamp = new Date().toISOString().slice(11, 19); // HH:MM:SS
      fs.appendFileSync(lp, `[${timestamp}] ${line}\n`, 'utf-8');
    } catch (err) {
      console.error(`[AniTaskManager] appendLog failed:`, err);
    }
  }

  /**
   * 写子任务 input.md
   */
  async writeSubtaskInput(taskId: string, subtaskId: string, content: string): Promise<void> {
    try {
      const sDir = subtaskDir(taskId, subtaskId);
      fs.mkdirSync(sDir, { recursive: true });
      fs.writeFileSync(path.join(sDir, 'input.md'), content, 'utf-8');
    } catch (err) {
      console.error(`[AniTaskManager] writeSubtaskInput failed:`, err);
    }
  }

  /**
   * 读子任务 input.md
   */
  async readSubtaskInput(taskId: string, subtaskId: string): Promise<string | null> {
    try {
      const p = path.join(subtaskDir(taskId, subtaskId), 'input.md');
      if (!fs.existsSync(p)) return null;
      return fs.readFileSync(p, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * 写子任务 output.md
   */
  async writeSubtaskOutput(taskId: string, subtaskId: string, content: string): Promise<void> {
    try {
      const sDir = subtaskDir(taskId, subtaskId);
      fs.mkdirSync(sDir, { recursive: true });
      fs.writeFileSync(path.join(sDir, 'output.md'), content, 'utf-8');
    } catch (err) {
      console.error(`[AniTaskManager] writeSubtaskOutput failed:`, err);
    }
  }

  /**
   * 读子任务 output.md
   */
  async readSubtaskOutput(taskId: string, subtaskId: string): Promise<string | null> {
    try {
      const p = path.join(subtaskDir(taskId, subtaskId), 'output.md');
      if (!fs.existsSync(p)) return null;
      return fs.readFileSync(p, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * 写 inbox 信号文件（done）
   */
  async signalDone(taskId: string): Promise<void> {
    try {
      const dir = inboxDir();
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${taskId}.done`), taskId, 'utf-8');
    } catch (err) {
      console.error(`[AniTaskManager] signalDone failed:`, err);
    }
  }

  /**
   * 写 inbox 信号文件（failed）
   */
  async signalFailed(taskId: string, errorSummary: string): Promise<void> {
    try {
      const dir = inboxDir();
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${taskId}.failed`), errorSummary, 'utf-8');
    } catch (err) {
      console.error(`[AniTaskManager] signalFailed failed:`, err);
    }
  }
}
