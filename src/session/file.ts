import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import path from 'path';
import type { Session, Message, SessionStore, SessionMeta } from '../types/index.js';
import { configManager } from '../aniConfig.js';
import { makeSession, toSessionMeta } from './utils.js';

export class FileSessionStore implements SessionStore {
  private sessionsDir: string;
  private currentSession: Session | null = null;

  constructor(sessionsDir?: string) {
    this.sessionsDir = sessionsDir ?? path.join(configManager.getConfigDir(), 'sessions');
    mkdirSync(this.sessionsDir, { recursive: true });
  }

  createSession(workspace: string): Session {
    this.currentSession = makeSession(workspace);
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
          const s = JSON.parse(readFileSync(path.join(this.sessionsDir, f), 'utf-8')) as Session;
          results.push({ ...toSessionMeta(s), createdAt: new Date(s.createdAt) });
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
    writeFileSync(
      path.join(this.sessionsDir, `${this.currentSession.id}.json`),
      JSON.stringify(this.currentSession),
      'utf-8',
    );
  }
}
