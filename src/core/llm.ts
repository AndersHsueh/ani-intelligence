/**
 * Ani LLM Client - single-process dialogue loop with tool calling
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ProviderFactory, type BaseProvider } from './providers/index.js';
import { configManager } from '../aniConfig.js';
import { constitution } from '../aniConstitution.js';
import { ToolExecutor } from '../tools/executor.js';
import { toolRegistry } from '../tools/registry.js';
import type { Message, ModelConfig } from '../types/index.js';
import type { ToolCallRecord, ToolExecutionContext } from '../types/tool.js';
import { getErrorMessage } from '../utils/error.js';
import { skillManager } from './skillManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface StreamEvent {
  type: 'text' | 'tool_call' | 'done' | 'error';
  content?: string;
  record?: ToolCallRecord;
  message?: string;
  conversation?: Message[];
}

export interface LLMClientOptions {
  systemPromptPath?: string;
}

export class LLMClient {
  private modelConfig: ModelConfig;
  private systemPrompt: string;
  private maxIterations: number;
  private toolExecutor: ToolExecutor;

  constructor(modelConfig: ModelConfig, options?: LLMClientOptions) {
    this.modelConfig = modelConfig;
    this.systemPrompt = this.loadSystemPrompt(options?.systemPromptPath);
    this.maxIterations = configManager.get().maxIterations ?? 15;
    this.toolExecutor = new ToolExecutor(configManager.get());
  }

  private loadSystemPrompt(customPath?: string): string {
    const projectRoot = path.join(__dirname, '..', '..');
    const promptPath = customPath ?? path.join(projectRoot, 'prompts', 'default.md');
    try {
      return readFileSync(promptPath, 'utf-8');
    } catch {
      return 'You are Ani, a minimalist terminal AI assistant.';
    }
  }

  private loadAgentPrompt(workspace: string): string {
    const agentPath = path.join(workspace, 'CLAUDE.md');
    if (!existsSync(agentPath)) return '';
    try {
      return readFileSync(agentPath, 'utf-8');
    } catch {
      return '';
    }
  }

  private compressMessages(messages: Message[], maxTokens: number = 16000): Message[] {
    const ESTIMATED_TOKENS_PER_CHAR = 0.25;
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    const estimatedTokens = totalChars * ESTIMATED_TOKENS_PER_CHAR;

    if (estimatedTokens <= maxTokens) return messages;

    const lastMessages = messages.slice(-20);
    const olderMessages = messages.slice(0, -20);

    const summary = `[Prior conversation summarized: ${olderMessages.length} messages omitted. Key topics covered in prior conversation.]`;

    return [
      { role: 'user', content: summary, timestamp: new Date() },
      ...lastMessages,
    ];
  }

  private buildSystemPrompt(workspace: string, skillsSummary: string): string {
    // Layer 1: Constitution (always first, never compressed)
    // Layer 2: System prompt (describes Ani's capabilities)
    // Layer 3: Skills/MCP (available tools)
    const layers123 =
      `${constitution}\n\n${this.systemPrompt}${skillsSummary ? '\n\n' + skillsSummary : ''}`;

    // Layer 4a: Agent context (CLAUDE.md in workspace)
    const agentPrompt = this.loadAgentPrompt(workspace);
    const agentLayer = agentPrompt ? '\n\n---\n\n## Agent Context\n\n' + agentPrompt : '';

    return layers123 + agentLayer;
  }

  async *chatStream(
    messages: Message[],
    workspace: string,
  ): AsyncGenerator<StreamEvent> {
    await skillManager.discover();
    const skillsSummary = skillManager.buildSkillsSummary();

    // Build system prompt with 4-layer structure
    // Layers 1-3: Constitution + System prompt + Skills (never compressed)
    // Layer 4a: Agent context from CLAUDE.md (never compressed)
    const systemPromptWithContext = this.buildSystemPrompt(workspace, skillsSummary);

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
      systemPromptWithContext,
    );

    // Layer 4b: User conversation history (compressed if too long)
    const conversation: Message[] = this.compressMessages([...messages]);
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
          // Push final assistant text into conversation so it's persisted
          if (accumulatedContent) {
            conversation.push({
              role: 'assistant',
              content: accumulatedContent,
              timestamp: new Date(),
            });
          }
          break;
        }
      } catch (error: unknown) {
        yield { type: 'error', message: getErrorMessage(error) };
        break;
      }
    }

    yield { type: 'done', conversation };
  }
}
