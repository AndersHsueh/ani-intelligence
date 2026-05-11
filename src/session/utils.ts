import type { Session, SessionMeta } from '../types/index.js';

export function makeSession(workspace: string): Session {
  return {
    id: `ani-${Date.now()}`,
    createdAt: new Date(),
    workspace,
    messages: [],
    metadata: {},
  };
}

export function toSessionMeta(s: Session): SessionMeta {
  return { id: s.id, createdAt: s.createdAt, workspace: s.workspace, caption: s.caption };
}
