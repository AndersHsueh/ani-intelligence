# IToolExecutor — 工具执行器接口

## 接口定义

```typescript
// src/types/tool.ts

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
```

## 关联类型

```typescript
// src/types/tool.ts

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };  // arguments 是 JSON 字符串
}

interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

interface ToolExecutionContext {
  workspace: string;  // 工具执行的工作目录
}

interface ToolCallRecord {
  id: string;
  toolName: string;
  toolLabel: string;
  params: any;
  status: 'pending' | 'running' | 'success' | 'error' | 'cancelled';
  result?: ToolResult;
  startTime: number;
  endTime?: number;
}
```

## 现有实现

### `ToolExecutor`
- **文件**: `src/tools/executor.ts`
- **特点**: 单进程内执行，支持 AbortSignal 取消，危险命令需用户确认
- **工具来源**: 从全局 `toolRegistry` 单例查找工具

## AniTool — 工具定义格式

每个工具是一个 `AniTool` 对象：

```typescript
interface AniTool {
  name: string;
  aliases?: string[];       // 别名列表（向后兼容）
  label: string;            // 显示名（中文友好）
  description: string;      // 模型可见的功能描述，要清晰自解释
  parameters: ToolParameterSchema;
  execute: (
    toolCallId: string,
    params: any,
    signal: AbortSignal,
    context?: ToolExecutionContext
  ) => Promise<ToolResult>;
}
```

## 新增 Builtin Tool

参照 `src/tools/builtin/readFile.ts` 结构新建文件，然后在 `src/tools/builtin/index.ts` 的 `builtinTools` 数组中注册：

```typescript
// src/tools/builtin/myTool.ts
import type { AniTool } from '../../types/tool.js';

export const myTool: AniTool = {
  name: 'myTool',
  label: '我的工具',
  description: '做某件具体的事。参数 xxx 是必填的。',  // 描述要让小模型也能理解
  parameters: {
    type: 'object',
    properties: {
      xxx: { type: 'string', description: '...' },
    },
    required: ['xxx'],
  },
  async execute(toolCallId, params, signal, context) {
    try {
      // ... 实现
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },
};
```

**注意**：`description` 要尽量具体，因为 Ani 实际运行时多数使用中小型开源模型，模型对工具描述的理解能力有限。

## 未来沙箱化路径

`LLMClient` 持有 `IToolExecutor` 接口引用，而非具体类。未来可以：

```typescript
// 子进程沙箱实现（示例，尚未实现）
class SandboxedToolExecutor implements IToolExecutor {
  // 将工具调用序列化，发送到独立子进程执行
  // OAuth token、凭据等不暴露给主进程
}

// 在 LLMClient 构造时注入
const client = new LLMClient(modelConfig, { executor: new SandboxedToolExecutor() });
```

接口已就绪，实现可随时替换，无需改动 TUI 层。
