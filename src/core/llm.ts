/**
 * Ani LLM Client - single-process dialogue loop with tool calling
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ProviderFactory, type BaseProvider } from './providers/index.js';
import { configManager } from '../aniConfig.js';
import { ToolExecutor } from '../tools/executor.js';
import { toolRegistry } from '../tools/registry.js';
import type { Message, ModelConfig } from '../types/index.js';
import type { ToolCallRecord, ToolExecutionContext } from '../types/tool.js';
import { getErrorMessage } from '../utils/error.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface StreamEvent {
  type: 'text' | 'tool_call' | 'done' | 'error';
  content?: string;
  record?: ToolCallRecord;
  message?: string;
}

export class LLMClient {
  private modelConfig: ModelConfig;
  private systemPrompt: string;
  private maxIterations: number;
  private toolExecutor: ToolExecutor;

  constructor(modelConfig: ModelConfig) {
    this.modelConfig = modelConfig;
    this.systemPrompt = this.loadSystemPrompt();
    this.maxIterations = configManager.get().maxIterations ?? 15;
    this.toolExecutor = new ToolExecutor(configManager.get());
  }

  private loadSystemPrompt(): string {
    // Try project root prompt/default.md
    const projectRoot = path.join(__dirname, '..', '..');
    try {
      return readFileSync(path.join(projectRoot, 'prompt', 'default.md'), 'utf-8');
    } catch {
      return 'You are Ani, a minimalist terminal AI assistant.';
    }
  }

  async *chatStream(
    messages: Message[],
    workspace: string,
  ): AsyncGenerator<StreamEvent> {
    const provider = ProviderFactory.create(
      this.modelConfig.provider,
      {
        baseURL: this.modelConfig.baseURL,
        model: this.modelConfig.model,
        apiKey: this.modelConfig.apiKey,
        temperature: this.modelConfig.temperature,
        maxTokens: this.modelConfig.maxTokens,
        promptCaching: this.modelConfig.promptCaching,
      },
      this.systemPrompt,
    );

    // Build conversation messages (system prompt is handled by provider)
    const conversation: Message[] = [...messages];
    const tools = toolRegistry.toOpenAIFunctions();
    const context: ToolExecutionContext = { workspace };

    let iteration = 0;

    while (iteration < this.maxIterations) {
      iteration++;

      try {
        const generator = provider.chatStreamWithTools(conversation, tools);

        let hasToolCalls = false;
        let accumulatedContent = '';

        for await (const chunk of generator) {
          if (chunk.type === 'text' && chunk.content) {
            accumulatedContent += chunk.content;
            yield { type: 'text', content: chunk.content };
          }

          if (chunk.type === 'tool_calls' && chunk.tool_calls?.length) {
            hasToolCalls = true;

            // Add assistant message with tool calls
            conversation.push({
              role: 'assistant',
              content: accumulatedContent || '',
              timestamp: new Date(),
              tool_calls: chunk.tool_calls,
            });

            // Execute tools
            for (const toolCall of chunk.tool_calls) {
              const record: ToolCallRecord = {
                id: toolCall.id,
                toolName: toolCall.function.name,
                toolLabel: toolCall.function.name,
                params: (() => { try { return JSON.parse(toolCall.function.arguments); } catch { return {}; } })(),
                status: 'running',
                startTime: Date.now(),
              };

              yield { type: 'tool_call', record: { ...record } };

              const result = await this.toolExecutor.execute(toolCall, undefined, context);

              record.status = result.success ? 'success' : 'error';
              record.result = result;
              record.endTime = Date.now();

              yield { type: 'tool_call', record: { ...record } };

              // Add tool result to conversation
              conversation.push({
                role: 'tool',
                content: JSON.stringify(result),
                timestamp: new Date(),
                tool_call_id: toolCall.id,
                name: toolCall.function.name,
              });
            }

            accumulatedContent = '';
            break; // Break out of stream to start next iteration
          }
        }

        if (!hasToolCalls) {
          // Conversation complete - no more tool calls
          break;
        }
      } catch (error: unknown) {
        yield { type: 'error', message: getErrorMessage(error) };
        break;
      }
    }

    yield { type: 'done' };
  }
}
