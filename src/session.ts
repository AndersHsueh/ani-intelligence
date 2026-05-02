/**
 * Ani Session - in-memory session management
 */
import type { Session, Message } from '../../types/index.js';

let currentSession: Session | null = null;

export function createSession(workspace: string): Session {
  currentSession = {
    id: `ani-${Date.now()}`,
    createdAt: new Date(),
    workspace,
    messages: [],
    metadata: {},
  };
  return currentSession;
}

export function getSession(): Session | null {
  return currentSession;
}

export function addMessage(msg: Message): void {
  if (currentSession) {
    currentSession.messages.push(msg);
  }
}

export function getMessages(): Message[] {
  return currentSession?.messages ?? [];
}
