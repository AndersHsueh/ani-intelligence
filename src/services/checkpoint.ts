/**
 * 文件快照服务（checkpointing）
 *
 * 在 editFile/writeFile 等工具真正落盘前，对目标文件做修改前快照；
 * 开关来自 settings general.checkpointing.enabled，默认关闭 → 行为完全不变。
 *
 * 快照以 JSON 形式存放在 baseDir 下（默认 ~/.alice/checkpoints），
 * 内容以 base64 存储，保证任意二进制/编码文件的逐字节还原。
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { configManager } from '../utils/config.js';
import { getErrorMessage } from '../utils/error.js';

interface CheckpointRecord {
  id: string;
  filePath: string;
  /** 修改前的文件内容（base64，保证逐字节还原） */
  contentBase64: string;
  /** 快照创建时间（epoch ms），用于 list 倒序 */
  createdAt: number;
}

/**
 * 把任意文件路径编码为可安全作为文件名的 key：
 * 绝对路径直接编码，不同路径互不冲突。
 */
function encodePathKey(filePath: string): string {
  return encodeURIComponent(filePath).replace(/%/g, '_');
}

export class CheckpointService {
  private baseDir: string;
  private enabled = false;

  /**
   * @param baseDir 快照存储目录；缺省为 <configDir>/checkpoints。
   *                测试必须传入临时目录（HOME 隔离）。
   */
  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? path.join(configManager.getConfigDir(), 'checkpoints');
    // 目录与开关无关地提前创建：未启用时目录存在但为空（测试护栏依赖），
    // 启用后快照可直接落盘。同步 mkdir 保证构造完成后目录一定存在。
    try {
      fsSync.mkdirSync(this.baseDir, { recursive: true });
    } catch {
      // 目录创建失败不阻断构造；真正写快照时仍会再次 mkdir
    }
  }

  /** 是否启用快照（来自 settings general.checkpointing.enabled，默认 false）。 */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * 从 settings 读取 general.checkpointing.enabled 并应用（daemon 启动时调用）。
   * settings 加载失败时保持默认关闭。可重复调用。
   */
  async init(): Promise<void> {
    try {
      const { loadSettings } = await import('../config/settings.js');
      const settings = loadSettings();
      const enabled =
        (settings.merged as { general?: { checkpointing?: { enabled?: boolean } } })
          .general?.checkpointing?.enabled === true;
      this.setEnabled(enabled);
    } catch {
      // 读取失败 → 保持默认关闭（行为不变）
      this.setEnabled(false);
    }
  }

  /** 只读 getter：快照目录。 */
  getBaseDir(): string {
    return this.baseDir;
  }

  /**
   * 在落盘前调用：
   * - 未启用 → 返回 null，不产生任何文件；
   * - 启用但文件不存在（writeFile 新建场景）→ 无内容可备份，返回 null；
   * - 启用且文件存在 → 写入修改前内容快照，返回 checkpoint id。
   * 快照失败不阻断写盘流程（返回 null），只记录警告。
   */
  async snapshotBeforeWrite(filePath: string): Promise<string | null> {
    if (!this.enabled) {
      return null;
    }
    try {
      const content = await fs.readFile(filePath);
      const id = randomUUID();
      const record: CheckpointRecord = {
        id,
        filePath,
        contentBase64: content.toString('base64'),
        createdAt: Date.now(),
      };
      await fs.mkdir(this.baseDir, { recursive: true });
      const snapshotPath = path.join(
        this.baseDir,
        `${encodePathKey(filePath)}.${id}.json`,
      );
      await fs.writeFile(snapshotPath, JSON.stringify(record), 'utf-8');
      return id;
    } catch (error: unknown) {
      // ENOENT：文件不存在 → 新文件无内容可备份，按契约返回 null；
      // 其他错误：快照失败不应阻断写盘，降级为 null。
      const code = (error as { code?: string }).code;
      if (code !== 'ENOENT') {
        console.warn(`checkpoint 快照失败（忽略并继续写盘）: ${getErrorMessage(error)}`);
      }
      return null;
    }
  }

  /**
   * 恢复：以 checkpoint 创建时的原始内容覆写 filePath，返回 true。
   * 未知 checkpoint id 或快照丢失时抛 Error。
   */
  async restore(filePath: string, checkpointId: string): Promise<boolean> {
    const record = await this.readRecord(filePath, checkpointId);
    const content = Buffer.from(record.contentBase64, 'base64');
    await fs.writeFile(filePath, content);
    return true;
  }

  /** 列出某文件的快照 id（按创建时间倒序）。 */
  async list(filePath: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.baseDir);
      const prefix = `${encodePathKey(filePath)}.`;
      const items: Array<{ id: string; createdAt: number }> = [];
      for (const name of entries) {
        if (!name.startsWith(prefix) || !name.endsWith('.json')) continue;
        try {
          const raw = await fs.readFile(path.join(this.baseDir, name), 'utf-8');
          const record = JSON.parse(raw) as CheckpointRecord;
          if (record.id && record.filePath === filePath) {
            items.push({ id: record.id, createdAt: record.createdAt });
          }
        } catch {
          // 单个快照损坏不影响其余条目
        }
      }
      return items
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((item) => item.id);
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      if (code === 'ENOENT') return [];
      return [];
    }
  }

  /** 读取并校验单条快照记录；未知 id/丢失 → 抛 Error。 */
  private async readRecord(filePath: string, checkpointId: string): Promise<CheckpointRecord> {
    const snapshotPath = path.join(
      this.baseDir,
      `${encodePathKey(filePath)}.${checkpointId}.json`,
    );
    let raw: string;
    try {
      raw = await fs.readFile(snapshotPath, 'utf-8');
    } catch (error: unknown) {
      throw new Error(
        `checkpoint 不存在或已丢失: file=${filePath} id=${checkpointId} (${getErrorMessage(error)})`,
      );
    }
    let record: CheckpointRecord;
    try {
      record = JSON.parse(raw) as CheckpointRecord;
    } catch (error: unknown) {
      throw new Error(`checkpoint 快照损坏: ${getErrorMessage(error)}`);
    }
    if (record.id !== checkpointId || record.filePath !== filePath) {
      throw new Error(`checkpoint 记录与请求不匹配: id=${checkpointId}`);
    }
    return record;
  }
}

/**
 * 默认全局实例（单例）。生产环境中 editFile/writeFile 工具与
 * /checkpoint 命令共享同一开关与快照目录。
 */
export const checkpointService = new CheckpointService();
