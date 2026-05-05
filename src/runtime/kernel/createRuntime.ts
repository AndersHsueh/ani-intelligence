import type { RuntimeChatRequest } from './runtimeTypes.js';
import { runAgentLoop, type AgentLoopDependencies } from '../agent/agentLoop.js';

export interface AniRuntime {
  runChat(request: RuntimeChatRequest): AsyncGenerator<import('./runtimeEvents.js').RuntimeEvent>;
}

export function createRuntime(deps: AgentLoopDependencies): AniRuntime {
  return {
    runChat(request: RuntimeChatRequest) {
      return runAgentLoop(request, deps);
    },
  };
}
