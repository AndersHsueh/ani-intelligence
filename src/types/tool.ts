/**
 * Ani 工具系统类型定义
 */

export interface IToolExecutor {
  execute(
    toolCall: ToolCall,
    onUpdate?: (record: ToolCallRecord) => void,
    context?: ToolExecutionContext
  ): Promise<ToolResult>;
  executeAll(
    toolCalls: ToolCall[],
    onUpdate?: (record: ToolCallRecord) => void,
    context?: ToolExecutionContext
  ): Promise<ToolResult[]>;
  cancel(toolCallId: string): void;
  cancelAll(): void;
  setConfirmHandler(handler: (message: string, command: string) => Promise<boolean>): void;
}

export interface ToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface ToolExecutionContext {
  workspace: string;
}

export interface AniTool {
  name: string;
  aliases?: string[];
  label: string;
  description: string;
  parameters: ToolParameterSchema;
  execute: (
    toolCallId: string,
    params: any,
    signal: AbortSignal,
    context?: ToolExecutionContext
  ) => Promise<ToolResult>;
}

export interface OpenAIFunction {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export type ToolCallStatus = 'pending' | 'running' | 'success' | 'error' | 'cancelled';

export interface ToolCallRecord {
  id: string;
  toolName: string;
  toolLabel: string;
  params: any;
  status: ToolCallStatus;
  result?: ToolResult;
  startTime: number;
  endTime?: number;
}
