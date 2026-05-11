# SessionStore — 会话持久化接口

## 接口定义

```typescript
// src/types/index.ts

export interface SessionMeta {
  id: string;
  createdAt: Date;
  workspace: string;
  caption?: string;
}

export interface SessionStore {
  createSession(workspace: string): Session;
  getSession(): Session | null;
  addMessage(msg: Message): void;
  getMessages(): Message[];
  setMessages(msgs: Message[]): void;
  listSessions(): SessionMeta[];
}
```

## 关联类型

```typescript
// src/types/index.ts

interface Session {
  id: string;
  createdAt: Date;
  updatedAt?: Date;
  caption?: string;
  workspace: string;
  messages: Message[];
  metadata: Record<string, any>;
}

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: Date;
  tool_calls?: ToolCall[];     // assistant 消息携带工具调用
  tool_call_id?: string;       // tool 消息关联的调用 ID
  name?: string;               // tool 消息的工具名
}
```

## 现有实现

### `FileSessionStore`（默认）
- **文件**: `src/session/file.ts`
- **存储位置**: `~/.ani/sessions/<session-id>.json`
- **写入时机**: `createSession`、`addMessage`、`setMessages` 均同步写盘
- **特点**: 进程重启后历史保留

### `MemorySessionStore`
- **文件**: `src/session/memory.ts`
- **存储位置**: 仅内存
- **适用场景**: 单元测试、不需要持久化的临时会话

## 公共模块 API

TUI 通过 `src/session.ts` 的模块函数访问 SessionStore，**不直接引用实现类**：

```typescript
import { createSession, getSession, addMessage, getMessages, setMessages } from './session.js';
```

这些函数内部委托给 `sessionStore` 实例。

## 替换实现（测试 / 扩展）

```typescript
// 测试中替换为内存实现，避免写盘
import { sessionStore } from './session.js';
import { MemorySessionStore } from './session/memory.js';

sessionStore = new MemorySessionStore();
```

## 新增自定义实现

实现 `SessionStore` 接口，放在 `src/session/` 下：

```typescript
import type { Session, Message, SessionStore, SessionMeta } from '../types/index.js';

export class MyCustomStore implements SessionStore {
  createSession(workspace: string): Session { /* ... */ }
  getSession(): Session | null { /* ... */ }
  addMessage(msg: Message): void { /* ... */ }
  getMessages(): Message[] { /* ... */ }
  setMessages(msgs: Message[]): void { /* ... */ }
  listSessions(): SessionMeta[] { /* ... */ }
}
```

然后在 `src/session.ts` 中替换默认实例即可。
