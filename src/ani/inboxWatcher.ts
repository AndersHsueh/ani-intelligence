/**
 * InboxWatcher — 监听 ~/.ani/inbox/ 目录，感知任务完成/失败信号
 *
 * 实现方式：Node.js fs.watch()
 * macOS fs.watch() 双触发问题：用 processedFiles Set 做幂等判断
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

export interface InboxSignal {
  taskId: string;
  status: 'done' | 'failed';
  message?: string;
}

export class InboxWatcher {
  private watcher: fs.FSWatcher | null = null;
  private processedFiles = new Set<string>();

  /**
   * 启动监听，传入回调
   */
  start(onSignal: (signal: InboxSignal) => void): void {
    const inboxDir = path.join(os.homedir(), '.ani', 'inbox');

    // 确保目录存在
    fs.mkdirSync(inboxDir, { recursive: true });

    // 先扫描已有文件（处理启动时已存在的信号）
    this.scanExistingFiles(inboxDir, onSignal);

    // 监听新文件
    this.watcher = fs.watch(inboxDir, (eventType, filename) => {
      if (!filename) return;
      this.processFile(path.join(inboxDir, filename), filename, onSignal);
    });
  }

  /**
   * 停止监听
   */
  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    this.processedFiles.clear();
  }

  private scanExistingFiles(inboxDir: string, onSignal: (signal: InboxSignal) => void): void {
    try {
      const files = fs.readdirSync(inboxDir);
      for (const filename of files) {
        this.processFile(path.join(inboxDir, filename), filename, onSignal);
      }
    } catch { /* 目录为空或不存在 */ }
  }

  private processFile(
    filePath: string,
    filename: string,
    onSignal: (signal: InboxSignal) => void,
  ): void {
    // 幂等：已处理过的文件跳过
    if (this.processedFiles.has(filename)) return;

    // 解析文件名
    let taskId: string;
    let status: 'done' | 'failed';

    if (filename.endsWith('.done')) {
      taskId = filename.slice(0, -5);
      status = 'done';
    } else if (filename.endsWith('.failed')) {
      taskId = filename.slice(0, -7);
      status = 'failed';
    } else {
      return; // 忽略非信号文件
    }

    // 检查文件是否还存在（macOS fs.watch 双触发问题）
    if (!fs.existsSync(filePath)) return;

    this.processedFiles.add(filename);

    // 读取文件内容
    let message: string | undefined;
    try {
      message = fs.readFileSync(filePath, 'utf-8').trim();
    } catch { /* 读取失败，message 为 undefined */ }

    // 触发回调
    onSignal({ taskId, status, message });

    // 处理完删除信号文件
    try {
      fs.unlinkSync(filePath);
    } catch { /* 删除失败不影响主流程 */ }
  }
}
