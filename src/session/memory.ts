import type { Session, Message, SessionStore, SessionMeta } from '../types/index.js';
import { makeSession, toSessionMeta } from './utils.js';

export class MemorySessionStore implements SessionStore {
  private currentSession: Session | null = null;

  createSession(workspace: string): Session {
    this.currentSession = makeSession(workspace);
    return this.currentSession;
  }

  getSession(): Session | null {
    return this.currentSession;
  }

  addMessage(msg: Message): void {
    if (this.currentSession) {
      this.currentSession.messages.push(msg);
      this.currentSession.updatedAt = new Date();
    }
  }

  getMessages(): Message[] {
    return this.currentSession?.messages ?? [];
  }

  setMessages(msgs: Message[]): void {
    if (this.currentSession) {
      this.currentSession.messages = [...msgs];
      this.currentSession.updatedAt = new Date();
    }
  }

  listSessions(): SessionMeta[] {
    if (!this.currentSession) return [];
    return [toSessionMeta(this.currentSession)];
  }
}
