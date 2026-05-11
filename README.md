# Ani

极简终端 AI 助手 — 单进程，本地优先，支持任意 OpenAI 兼容模型。

## 快速开始

```bash
bun install
bun run dev
```

首次启动会进入 Onboarding 引导，录入岗位与项目信息。

## 配置

编辑 `~/.ani/settings.jsonc`（参考 `settings.jsonc.sample`）：

```jsonc
{
  "default_model": "ollama",
  "models": [
    {
      "name": "ollama",
      "provider": "ollama",
      "baseURL": "http://localhost:11434/v1",
      "model": "qwen3",
      "apiKey": "ollama",
      "temperature": 0.7,
      "maxTokens": 8192
    }
  ],
  "workspace": "/your/project",
  "maxIterations": 15
}
```

### 支持的 Provider

| Provider key | 说明 |
|---|---|
| `ollama` | 本地 Ollama |
| `lmstudio` | LM Studio |
| `openai` | OpenAI API |
| `azure` | Azure OpenAI |
| `xai` / `grok` | xAI Grok |
| `custom` | 任意 OpenAI 兼容接口 |
| `anthropic` / `claude` | Anthropic Claude |

## 架构

```
index.tsx (Ink/React TUI)
  └─ AppContainer
       └─ useAliceStream
            └─ LLMClient (core/llm.ts)
                 ├─ ProviderFactory → BaseProvider（流式对话）
                 └─ IToolExecutor  → ToolExecutor（工具执行）
```

单进程运行，无 daemon。用户输入 → LLMClient 推理循环 → 工具调用 → 流式输出到 TUI。

## 内置工具

| 工具 | 说明 |
|---|---|
| `readFile` | 读取文件 |
| `writeFile` | 写入文件 |
| `editFile` | 编辑文件 |
| `listFiles` | 列出目录 |
| `searchFiles` | 搜索文件内容 |
| `executeCommand` | 执行 shell 命令 |
| `askUser` | 向用户提问 |
| `sequentialThinking` | 分步推理 |
| `loadSkill` | 加载外部 Skill |

## Skills 插件

将 Skill 目录放入 `~/.ani/skills/`，Ani 会自动发现并注入系统提示词。

## 数据目录

```
~/.ani/
  settings.jsonc      # 用户配置
  sessions/           # 会话历史（JSON，进程重启后保留）
  users/              # 用户档案（Onboarding 写入）
  skills/             # Skills 插件
```

## 开发阶段

| Tag | 内容 |
|-----|------|
| v0.1.0 | MVP：单进程对话循环 |
| v0.2.0 | Phase 1：Onboarding 流程、Skills 能力 |
| v0.3.0 | 4 层提示词架构（Constitution + System + Skills + Agent Context） |
| v0.4.0 | 接口边界提取：SessionStore / IToolExecutor / BaseProvider，会话持久化 |

## 扩展开发

参见 `docs/` 目录：

- [`docs/session-store.md`](docs/session-store.md) — 会话存储接口，如何替换实现
- [`docs/tool-executor.md`](docs/tool-executor.md) — 工具执行器接口，如何新增工具
- [`docs/llm-provider.md`](docs/llm-provider.md) — Provider 接口，如何接入新模型

## License

MIT
