import type { IToolExecutor, AniTool, ToolCall, ToolCallRecord, ToolResult, ToolExecutionContext } from '../types/tool.js';
import type { Config } from '../types/index.js';
import { toolRegistry } from './registry.js';
import { isDangerousCommand } from './builtin/executeCommand.js';
import { getErrorMessage } from '../utils/error.js';

export class ToolExecutor implements IToolExecutor {
  private config: Config;
  private abortControllers: Map<string, AbortController> = new Map();
  private onConfirm?: (message: string, command: string) => Promise<boolean>;

  constructor(config: Config) {
    this.config = config;
  }

  setConfirmHandler(handler: (message: string, command: string) => Promise<boolean>): void {
    this.onConfirm = handler;
  }

  async execute(
    toolCall: ToolCall,
    onUpdate?: (record: ToolCallRecord) => void,
    context?: ToolExecutionContext
  ): Promise<ToolResult> {
    const { id, function: func } = toolCall;
    const toolName = func.name;

    const tool = toolRegistry.get(toolName);
    if (!tool) {
      return { success: false, error: `Tool not found: ${toolName}` };
    }

    let params: any;
    try {
      params = JSON.parse(func.arguments);
    } catch {
      return { success: false, error: `Failed to parse arguments: ${func.arguments}` };
    }

    if (toolName === 'executeCommand' && this.config.dangerous_cmd) {
      if (isDangerousCommand(params.command)) {
        const confirmed = await this.confirmDangerousCommand(params.command);
        if (!confirmed) {
          return { success: false, error: 'User cancelled execution' };
        }
      }
    }

    const controller = new AbortController();
    this.abortControllers.set(id, controller);

    const record: ToolCallRecord = {
      id, toolName, toolLabel: tool.label, params,
      status: 'running', startTime: Date.now(),
    };
    onUpdate?.(record);

    try {
      const result = await tool.execute(id, params, controller.signal, context);
      record.status = result.success ? 'success' : 'error';
      record.result = result;
      record.endTime = Date.now();
      onUpdate?.(record);
      return result;
    } catch (error: unknown) {
      const result: ToolResult = { success: false, error: getErrorMessage(error) || 'Tool execution failed' };
      record.status = 'error';
      record.result = result;
      record.endTime = Date.now();
      onUpdate?.(record);
      return result;
    } finally {
      this.abortControllers.delete(id);
    }
  }

  async executeAll(
    toolCalls: ToolCall[],
    onUpdate?: (record: ToolCallRecord) => void,
    context?: ToolExecutionContext
  ): Promise<ToolResult[]> {
    return Promise.all(toolCalls.map(call => this.execute(call, onUpdate, context)));
  }

  cancel(toolCallId: string): void {
    const controller = this.abortControllers.get(toolCallId);
    if (controller) { controller.abort(); this.abortControllers.delete(toolCallId); }
  }

  cancelAll(): void {
    for (const controller of this.abortControllers.values()) { controller.abort(); }
    this.abortControllers.clear();
  }

  private async confirmDangerousCommand(command: string): Promise<boolean> {
    if (!this.onConfirm) return false;
    return await this.onConfirm(`⚠️ Dangerous command!\n\n${command}\n\nExecute?`, command);
  }
}
