import axios from 'axios';
import { BaseProvider, type ProviderConfig, type ChatResponse } from './base.js';
import type { Message } from '../../types/index.js';
import type { OpenAIFunction, ToolCall } from '../../types/tool.js';

type AnthropicRole = 'user' | 'assistant';

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: AnthropicTextBlock[];
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

interface AnthropicMessage {
  role: AnthropicRole;
  content: AnthropicContentBlock[];
}

export class AnthropicProvider extends BaseProvider {
  private buildAnthropicMessages(messages: Message[]): AnthropicMessage[] {
    const apiMessages: AnthropicMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') continue;

      if (msg.role === 'user') {
        apiMessages.push({ role: 'user', content: [{ type: 'text', text: msg.content }] });
        continue;
      }

      if (msg.role === 'assistant') {
        const contentBlocks: AnthropicContentBlock[] = [];
        if (msg.content && msg.content.trim()) {
          contentBlocks.push({ type: 'text', text: msg.content });
        }
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          for (const call of msg.tool_calls) {
            let input: unknown = {};
            try { input = call.function.arguments ? JSON.parse(call.function.arguments) : {}; } catch { input = { _raw: call.function.arguments }; }
            contentBlocks.push({ type: 'tool_use', id: call.id, name: call.function.name, input });
          }
        }
        if (contentBlocks.length > 0) {
          apiMessages.push({ role: 'assistant', content: contentBlocks });
        }
        continue;
      }

      if (msg.role === 'tool') {
        const toolResultBlock: AnthropicToolResultBlock = {
          type: 'tool_result',
          tool_use_id: msg.tool_call_id || 'tool_call',
          content: [{ type: 'text', text: msg.content }],
        };
        const last = apiMessages[apiMessages.length - 1];
        const isLastToolResultUser = last && last.role === 'user' &&
          Array.isArray(last.content) && last.content.length > 0 &&
          last.content.every((b) => b.type === 'tool_result');
        if (isLastToolResultUser) {
          (last.content as AnthropicContentBlock[]).push(toolResultBlock);
        } else {
          apiMessages.push({ role: 'user', content: [toolResultBlock] });
        }
      }
    }

    return apiMessages;
  }

  async testConnection(): Promise<{ success: boolean; speed: number; error?: string }> {
    const startTime = Date.now();
    try {
      await axios.post(`${this.config.baseURL}/v1/messages`, {
        model: this.config.model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 10
      }, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey || '',
          'anthropic-version': '2023-06-01',
        },
        timeout: 10000,
      });
      return { success: true, speed: (Date.now() - startTime) / 1000 };
    } catch (error) {
      return { success: false, speed: 0, error: error instanceof Error ? error.message : 'unknown' };
    }
  }

  async chatWithTools(messages: Message[], tools: OpenAIFunction[]): Promise<ChatResponse> {
    const apiMessages = this.buildAnthropicMessages(messages);
    const anthropicTools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters
    }));

    const response = await axios.post(`${this.config.baseURL}/v1/messages`, {
      model: this.config.model,
      messages: apiMessages,
      system: this.systemPrompt,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      tools: anthropicTools,
      tool_choice: { type: 'auto' },
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey || '',
        'anthropic-version': '2023-06-01',
      },
    });

    const data = response.data as { content: AnthropicContentBlock[] };

    const toolUseBlocks = data.content.filter(
      (block): block is AnthropicToolUseBlock => block.type === 'tool_use'
    );

    if (toolUseBlocks.length > 0) {
      const tool_calls: ToolCall[] = toolUseBlocks.map(block => ({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: JSON.stringify(block.input) }
      }));
      return { type: 'tool_calls', content: '', tool_calls };
    }

    const textBlocks = data.content.filter(
      (block): block is AnthropicTextBlock => block.type === 'text'
    );
    return { type: 'text', content: textBlocks.map(b => b.text).join('') };
  }

  async *chatStreamWithTools(
    messages: Message[],
    tools: OpenAIFunction[]
  ): AsyncGenerator<ChatResponse> {
    // Anthropic streaming: use non-streaming for tool calls
    const result = await this.chatWithTools(messages, tools);
    yield result;
  }
}
