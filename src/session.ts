import { FileSessionStore } from './session/file.js';
import type { SessionStore, Message } from './types/index.js';

// Exported so tests can swap in MemorySessionStore without touching disk.
export let sessionStore: SessionStore = new FileSessionStore();

export function createSession(workspace: string) {
  return sessionStore.createSession(workspace);
}

export function getSession() {
  return sessionStore.getSession();
}

export function addMessage(msg: Message): void {
  sessionStore.addMessage(msg);
}

export function getMessages() {
  return sessionStore.getMessages();
}

export function setMessages(msgs: Message[]): void {
  sessionStore.setMessages(msgs);
}
