# BaseProvider — LLM 提供者接口

## 抽象类定义

```typescript
// src/core/providers/base.ts

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
  content?: string;        // type='text' 时有值
  tool_calls?: ToolCall[]; // type='tool_calls' 时有值
}

export abstract class BaseProvider {
  protected config: ProviderConfig;
  protected systemPrompt: string;

  constructor(config: ProviderConfig, systemPrompt: string) { /* ... */ }

  // 核心方法：流式返回 LLM 响应（文本或工具调用）
  abstract chatStreamWithTools(
    messages: Message[],
    tools: OpenAIFunction[]
  ): AsyncGenerator<ChatResponse>;

  // 连通性测试，返回速度（ms）
  abstract testConnection(): Promise<{ success: boolean; speed: number; error?: string }>;

  // 将 Ani Message[] 格式转换为 OpenAI messages 数组
  protected buildMessages(messages: Message[]): Array<any> { /* ... */ }
}
```

## 现有实现

| Provider key | 类 | 文件 | 说明 |
|---|---|---|---|
| `ollama`, `lmstudio`, `openai`, `azure`, `custom`, `xai`, `grok` | `OpenAICompatibleProvider` | `src/core/providers/openai-compatible.ts` | SSE 流式，axios POST /chat/completions |
| `anthropic`, `claude` | `AnthropicProvider` | `src/core/providers/anthropic.ts` | 非流式，单次 yield |

**注意**：`AnthropicProvider` 目前不做真正的 token 级流式，`chatStreamWithTools` 内部调用同步方法后一次性 yield 结果。

## ProviderFactory 用法

`LLMClient` 通过 `ProviderFactory.create()` 创建 provider，无需直接引用具体类：

```typescript
// src/core/providers/index.ts
const provider = ProviderFactory.create(
  modelConfig.provider,   // provider 字符串，如 'ollama'
  {
    baseURL, model, apiKey, temperature, maxTokens, promptCaching,
  },
  systemPrompt,
);
```

## 新增 Provider

1. 继承 `BaseProvider`，实现 `chatStreamWithTools` 和 `testConnection`
2. 在 `src/core/providers/index.ts` 的 `ProviderRegistry` 中注册：

```typescript
// src/core/providers/my-provider.ts
import { BaseProvider, type ChatResponse } from './base.js';

export class MyProvider extends BaseProvider {
  async *chatStreamWithTools(messages, tools): AsyncGenerator<ChatResponse> {
    // 调用自定义 API，yield ChatResponse 对象
    // type='text': { type: 'text', content: '...' }
    // type='tool_calls': { type: 'tool_calls', tool_calls: [...] }
    yield { type: 'text', content: 'Hello' };
  }

  async testConnection() {
    const start = Date.now();
    // 简单 ping
    return { success: true, speed: Date.now() - start };
  }
}

// src/core/providers/index.ts 中注册
providerRegistry.register('my-provider', MyProvider);
```

3. 在 `src/types/index.ts` 的 `Provider` union 中添加新的 provider key。

## 错误处理

`LLMClient.chatStream()` 在整个推理循环外包有 try-catch（`src/core/llm.ts:201`）。Provider 抛出的错误会被捕获并以 `StreamEvent { type: 'error', message }` 形式传递给 TUI，不会导致进程崩溃。

Provider 实现内部**不需要**自行捕获所有错误，抛出即可，由上层处理。
