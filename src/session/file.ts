import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import type { Session, Message, SessionStore, SessionMeta } from '../types/index.js';

export class FileSessionStore implements SessionStore {
  private sessionsDir: string;
  private currentSession: Session | null = null;

  constructor(sessionsDir?: string) {
    this.sessionsDir = sessionsDir ?? path.join(os.homedir(), '.ani', 'sessions');
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  createSession(workspace: string): Session {
    this.currentSession = {
      id: `ani-${Date.now()}`,
      createdAt: new Date(),
      workspace,
      messages: [],
      metadata: {},
    };
    this.persist();
    return this.currentSession;
  }

  getSession(): Session | null {
    return this.currentSession;
  }

  addMessage(msg: Message): void {
    if (this.currentSession) {
      this.currentSession.messages.push(msg);
      this.currentSession.updatedAt = new Date();
      this.persist();
    }
  }

  getMessages(): Message[] {
    return this.currentSession?.messages ?? [];
  }

  setMessages(msgs: Message[]): void {
    if (this.currentSession) {
      this.currentSession.messages = [...msgs];
      this.currentSession.updatedAt = new Date();
      this.persist();
    }
  }

  listSessions(): SessionMeta[] {
    try {
      const results: SessionMeta[] = [];
      for (const f of readdirSync(this.sessionsDir)) {
        if (!f.endsWith('.json')) continue;
        try {
          const raw = readFileSync(path.join(this.sessionsDir, f), 'utf-8');
          const s = JSON.parse(raw) as Session;
          results.push({
            id: s.id,
            createdAt: new Date(s.createdAt),
            workspace: s.workspace,
            caption: s.caption,
          });
        } catch {
          // skip corrupt files
        }
      }
      return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } catch {
      return [];
    }
  }

  private persist(): void {
    if (!this.currentSession) return;
    const filePath = path.join(this.sessionsDir, `${this.currentSession.id}.json`);
    writeFileSync(filePath, JSON.stringify(this.currentSession, null, 2), 'utf-8');
  }
}
