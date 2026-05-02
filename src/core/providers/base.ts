import type { Message } from '../../types/index.js';
import type { OpenAIFunction, ToolCall } from '../../types/tool.js';

export interface ProviderConfig {
  baseURL: string;
  model: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
  promptCaching?: boolean;
}

export interface ChatResponse {
  type: 'text' | 'tool_calls';
  content?: string;
  tool_calls?: ToolCall[];
}

export abstract class BaseProvider {
  protected config: ProviderConfig;
  protected systemPrompt: string;

  constructor(config: ProviderConfig, systemPrompt: string) {
    this.config = config;
    this.systemPrompt = systemPrompt;
  }

  abstract chatStreamWithTools(
    messages: Message[],
    tools: OpenAIFunction[]
  ): AsyncGenerator<ChatResponse>;

  abstract testConnection(): Promise<{ success: boolean; speed: number; error?: string }>;

  protected buildMessages(messages: Message[]): Array<any> {
    const result: any[] = [];

    result.push({
      role: 'system',
      content: this.systemPrompt,
    });

    for (const msg of messages) {
      if (msg.role === 'tool') {
        result.push({
          role: 'tool',
          tool_call_id: msg.tool_call_id,
          name: msg.name,
          content: msg.content,
        });
      } else if (msg.tool_calls) {
        result.push({
          role: 'assistant',
          content: msg.content || '',
          tool_calls: msg.tool_calls,
        });
      } else {
        result.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    return result;
  }
}
