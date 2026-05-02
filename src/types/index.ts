export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: Date;
  tool_calls?: import('./tool.js').ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface Session {
  id: string;
  createdAt: Date;
  updatedAt?: Date;
  caption?: string;
  workspace: string;
  messages: Message[];
  metadata: Record<string, any>;
}

export type Provider =
  | 'lmstudio'
  | 'ollama'
  | 'openai'
  | 'azure'
  | 'custom'
  | 'xai'
  | 'grok'
  | 'anthropic'
  | 'claude'
  | 'google'
  | 'gemini'
  | 'mistral';

export interface ModelConfig {
  name: string;
  provider: Provider;
  baseURL: string;
  model: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
  last_update_datetime: string | null;
  speed: number | null;
  promptCaching?: boolean;
  notes?: string;
}

export interface Config {
  default_model: string;
  models: ModelConfig[];
  workspace: string;
  dangerous_cmd: boolean;
  maxIterations?: number;
}

export * from './tool.js';
