import axios, { AxiosInstance } from 'axios';
import { Readable } from 'stream';
import { BaseProvider, type ProviderConfig, type ChatResponse } from './base.js';
import type { Message } from '../../types/index.js';
import type { OpenAIFunction } from '../../types/tool.js';

function readStreamToString(stream: unknown): Promise<string> {
  if (stream == null || typeof (stream as Readable).on !== 'function') {
    return Promise.resolve('');
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    (stream as Readable).on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    (stream as Readable).on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    (stream as Readable).on('error', reject);
  });
}

export class OpenAICompatibleProvider extends BaseProvider {
  private client: AxiosInstance;

  constructor(config: ProviderConfig, systemPrompt: string) {
    super(config, systemPrompt);

    this.client = axios.create({
      baseURL: config.baseURL,
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey && { 'Authorization': `Bearer ${config.apiKey}` }),
      },
      timeout: 120000,
    });
  }

  async testConnection(): Promise<{ success: boolean; speed: number; error?: string }> {
    const startTime = Date.now();
    try {
      const response = await this.client.post('/chat/completions', {
        model: this.config.model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 10,
        stream: false,
      });
      return { success: true, speed: (Date.now() - startTime) / 1000 };
    } catch (error) {
      return { success: false, speed: 0, error: error instanceof Error ? error.message : 'unknown' };
    }
  }

  async *chatStreamWithTools(
    messages: Message[],
    tools: OpenAIFunction[]
  ): AsyncGenerator<ChatResponse> {
    try {
      const requestMessages = this.buildMessages(messages);

      const response = await this.client.post(
        '/chat/completions',
        {
          model: this.config.model,
          messages: requestMessages,
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
          tools: tools.map(t => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters }
          })),
          tool_choice: 'auto',
          stream: true,
          stream_options: { include_usage: true },
        },
        { responseType: 'stream' }
      );

      const stream = response.data;
      let buffer = '';
      let accumulatedToolCalls: any[] = [];
      let accumulatedContent = '';

      for await (const chunk of stream) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();

            if (data === '[DONE]') {
              if (accumulatedToolCalls.length > 0) {
                yield { type: 'tool_calls', tool_calls: accumulatedToolCalls, content: accumulatedContent || undefined };
              }
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;
              if (!delta) continue;

              if (delta.content) {
                accumulatedContent += delta.content;
                yield { type: 'text', content: delta.content };
              }

              if (delta.tool_calls) {
                for (const toolCall of delta.tool_calls) {
                  const index = toolCall.index;
                  if (!accumulatedToolCalls[index]) {
                    accumulatedToolCalls[index] = {
                      id: toolCall.id || '',
                      type: 'function',
                      function: { name: toolCall.function?.name || '', arguments: '' },
                    };
                  }
                  if (toolCall.function?.name) {
                    accumulatedToolCalls[index].function.name = toolCall.function.name;
                  }
                  if (toolCall.function?.arguments) {
                    accumulatedToolCalls[index].function.arguments += toolCall.function.arguments;
                  }
                  if (toolCall.id) {
                    accumulatedToolCalls[index].id = toolCall.id;
                  }
                }
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      }
    } catch (error: unknown) {
      await this.normalizeStreamErrorResponse(error);
      throw this.handleError(error);
    }
  }

  private async normalizeStreamErrorResponse(error: unknown): Promise<void> {
    if (!axios.isAxiosError(error) || !error.response?.data) return;
    const data = error.response.data as unknown;
    if (typeof (data as Readable).on !== 'function') return;
    try {
      const body = await readStreamToString(data);
      if (body.length > 0) {
        try { error.response.data = JSON.parse(body); } catch { error.response.data = body; }
      }
    } catch { /* ignore */ }
  }

  private getResponseErrorMessage(data: unknown): string {
    if (data == null) return 'unknown error';
    if (typeof data === 'string') return data.trim().slice(0, 500) || 'unknown error';
    if (typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      const msg = (obj.error as Record<string, unknown> | undefined)?.message ?? obj.message;
      if (typeof msg === 'string') return msg.slice(0, 500);
    }
    return 'unknown error';
  }

  private handleError(error: unknown): Error {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNREFUSED') return new Error('Cannot connect to server');
      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') return new Error('Connection timeout');
      if (error.response) {
        return new Error(`API error (${error.response.status}): ${this.getResponseErrorMessage(error.response.data)}`);
      }
      if (error.request) return new Error('No response from server');
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
