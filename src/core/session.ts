import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { configManager } from '../utils/config.js';
import type { Message, Session } from '../types/index.js';
import { inferWorkspaceMetadataFromSession } from '../runtime/workspace/workspaceResolver.js';

export class SessionManager {
  private sessionDir: string;
  private currentSession: Session | null = null;

  /**
   * @param baseDir 可选基目录（测试注入临时目录用，HOME 隔离）；
   *                缺省保持向后兼容，仍使用 configManager.getConfigDir()。
   */
  constructor(baseDir?: string) {
    this.sessionDir = path.join(baseDir ?? configManager.getConfigDir(), 'sessions');
  }

  /** 只读 getter：返回会话文件所在目录（<base>/sessions），供调用方做隔离校验。 */
  getSessionDir(): string {
    return this.sessionDir;
  }

  /**
   * 删除指定会话文件。
   * - id 为当前会话时返回 false 且不删任何文件（防删当前）；
   * - 会话文件不存在时返回 false（幂等，不抛异常）；
   * - 成功删除返回 true。
   */
  async deleteSession(id: string): Promise<boolean> {
    if (this.currentSession && id === this.currentSession.id) {
      return false;
    }
    try {
      const filePath = path.join(this.sessionDir, `${id}.json`);
      await fs.access(filePath);
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 设置会话标题（caption）并持久化到会话文件。
   * 会话不存在时返回 false；成功返回 true，
   * 之后 loadSession/listSessions 均返回新 caption。
   */
  async setSessionCaption(id: string, caption: string): Promise<boolean> {
    const session = await this.loadSession(id);
    if (!session) {
      return false;
    }
    session.caption = caption;
    await this.saveSession(session);
    return true;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.sessionDir, { recursive: true });
  }

  async createSession(workspace?: string): Promise<Session> {
    const session: Session = {
      id: randomUUID(),
      createdAt: new Date(),
      workspace: workspace || configManager.get()?.workspace || process.cwd(),
      messages: [],
      metadata: {},
    };

    this.currentSession = session;
    await this.saveSession(session);

    return session;
  }

  async saveSession(session: Session): Promise<void> {
    const filePath = path.join(this.sessionDir, `${session.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8');
  }

  async loadSession(id: string): Promise<Session | null> {
    try {
      const filePath = path.join(this.sessionDir, `${id}.json`);
      const data = await fs.readFile(filePath, 'utf-8');
      const session = JSON.parse(data) as Session;
      
      // 转换日期字符串为 Date 对象
      session.createdAt = new Date(session.createdAt);
      session.messages = session.messages.map((msg: any) => ({
        ...msg,
        timestamp: new Date(msg.timestamp),
      }));

      const inferred = inferWorkspaceMetadataFromSession(session);
      const prevMeta = (session.metadata ?? {}) as Record<string, any>;
      const missingBinding =
        prevMeta.workspaceBackendId !== inferred.workspaceBackendId ||
        prevMeta.workspaceBackendKind !== inferred.workspaceBackendKind ||
        ((prevMeta.channel ?? undefined) !== (inferred.channel ?? undefined)) ||
        ((prevMeta.chatId ?? undefined) !== (inferred.chatId ?? undefined));

      if (missingBinding) {
        session.metadata = {
          ...prevMeta,
          ...inferred,
        };
        await this.saveSession(session);
      }
      
      return session;
    } catch (error) {
      return null;
    }
  }

  async openSession(id: string): Promise<Session | null> {
    const session = await this.loadSession(id);
    if (session) {
      this.currentSession = session;
    }
    return session;
  }

  async listSessions(): Promise<Session[]> {
    try {
      const files = await fs.readdir(this.sessionDir);
      const sessions: Session[] = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          const id = file.replace('.json', '');
          const session = await this.loadSession(id);
          if (session) {
            sessions.push(session);
          }
        }
      }

      return sessions.sort((a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime()
      );
    } catch (error) {
      return [];
    }
  }

  async addMessage(message: Message): Promise<void> {
    if (!this.currentSession) {
      await this.createSession();
    }

    this.currentSession!.messages.push(message);
    await this.saveSession(this.currentSession!);
  }

  getCurrentSession(): Session | null {
    return this.currentSession;
  }

  async clearCurrentSession(): Promise<void> {
    if (this.currentSession) {
      this.currentSession.messages = [];
      await this.saveSession(this.currentSession);
    }
  }
}

export const sessionManager = new SessionManager();
