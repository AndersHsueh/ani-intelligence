import type { Session, Message, SessionStore, SessionMeta } from '../types/index.js';

export class MemorySessionStore implements SessionStore {
  private currentSession: Session | null = null;

  createSession(workspace: string): Session {
    this.currentSession = {
      id: `ani-${Date.now()}`,
      createdAt: new Date(),
      workspace,
      messages: [],
      metadata: {},
    };
    return this.currentSession;
  }

  getSession(): Session | null {
    return this.currentSession;
  }

  addMessage(msg: Message): void {
    if (this.currentSession) {
      this.currentSession.messages.push(msg);
    }
  }

  getMessages(): Message[] {
    return this.currentSession?.messages ?? [];
  }

  setMessages(msgs: Message[]): void {
    if (this.currentSession) {
      this.currentSession.messages = [...msgs];
    }
  }

  listSessions(): SessionMeta[] {
    if (!this.currentSession) return [];
    return [{
      id: this.currentSession.id,
      createdAt: this.currentSession.createdAt,
      workspace: this.currentSession.workspace,
      caption: this.currentSession.caption,
    }];
  }
}
