# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**Ani** is a single-process terminal AI assistant — a minimalist rewrite of ALICE (described in `alice1.md`). The original ALICE had a dual-process architecture (CLI + daemon over HTTP). Ani runs everything in one Bun process.

## Context file

Ani uses `agent.md` (not `GEMINI.md`) as the project context file. The `/init` command analyzes the project and creates/updates this file. The filename is controlled by `ANI_CONTEXT_FILENAME` in `src/shim/qwen-code-core.ts`.

## Run

```bash
bun run dev        # or: bun run src/index.tsx
```

Requires `~/.ani/settings.jsonc` with model config. See `settings.jsonc.sample`.

## Architecture

```
index.tsx (Ink render, provider tree)
  └─ AppContainer (TUI state, history, input)
       └─ useAliceStream (shim/hooks/useAliceStream.ts)
            └─ LLMClient (core/llm.ts)
                 ├─ ProviderFactory → AnthropicProvider / OpenAICompatibleProvider
                 └─ ToolExecutor → toolRegistry → builtin tools
```

**Single-process flow**: User input → `useAliceStream.submitQuery()` → `LLMClient.chatStream()` → provider calls LLM API → tool calls execute locally in same process → results fed back to LLM → final text streamed to TUI.

## Custom vs Copied code

**Custom Ani code** (write/modify freely):
- `src/index.tsx` — entry point
- `src/aniConfig.ts` — config manager (`~/.ani/settings.jsonc`)
- `src/session.ts` — in-memory session store
- `src/core/llm.ts` — dialogue loop with tool calling
- `src/core/providers/` — LLM provider implementations
- `src/tools/registry.ts`, `executor.ts`, `builtin/` — tool system
- `src/shim/hooks/useAliceStream.ts` — connects TUI to local LLMClient
- `src/types/index.ts`, `tool.ts` — core type definitions
- `prompt/default.md` — system prompt
- `src/utils/daemonClient.ts` — stub (replaces daemon)
- `src/utils/error.ts` — error helper

**Copied from alice/qwen-code** (treat as third-party; avoid modifying):
- `src/ui/` — Ink/React TUI (431 files)
- `src/config/` — qwen-code settings system
- `src/commands/` — extension/command system
- `src/i18n/`, `src/constants/`, `src/services/`, `src/runtime/`
- `src/acp-integration/`, `src/legacy-cli/`, `src/generated/`
- `src/shim/qwen-code-core.ts` — type stubs for qwen-code imports
- Most of `src/utils/` — copied utilities

## Key design points

- **No daemon**: The `DaemonClient` in `src/utils/daemonClient.ts` is a stub. All LLM calls and tool execution happen synchronously in the TUI process.
- **Shim layer**: The qwen-code TUI imports `@qwen-code/qwen-code-core`. This is resolved via `package.json` `imports` field to `src/shim/qwen-code-core.ts`, which provides type stubs and no-ops.
- **useAliceStream**: The critical adapter — aliased as `useGeminiStream` in `src/ui/hooks/useGeminiStream.ts` so the TUI uses it transparently.
- **Anthropic provider is non-streaming**: `chatStreamWithTools` wraps the sync `chatWithTools` and yields a single result. Only OpenAI-compatible providers do true token-by-token streaming.
- **Sessions are in-memory**: `src/session.ts` — no filesystem persistence.

## Provider support

| Provider key | Implementation | Streaming |
|---|---|---|
| `ollama`, `lmstudio`, `openai`, `azure`, `xai`, `grok`, `custom` | `OpenAICompatibleProvider` | SSE |
| `anthropic`, `claude` | `AnthropicProvider` | No |

## Config

`~/.ani/settings.jsonc` (JSON with comments):
- `default_model` — model name key
- `models[]` — array of `{ name, provider, baseURL, model, apiKey, temperature, maxTokens }`
- `workspace` — working directory
- `maxIterations` — max tool-calling loop iterations (default 15)

## Slash Commands

Built-in slash commands (defined in `src/ui/commands/`):
- `/init` — analyze project and create `agent.md`
- `/clear`, `/new`, `/reset` — clear conversation and start new session
- `/quit`, `/exit`, `/bye` — exit the application
- `/help`, `/?` — show help
- `/model` — model selection
- `/theme` — theme selection
- `/settings` — open settings
- `/memory` — memory management
- And many more...

Command aliases are defined via `altNames` array in each command's `SlashCommand` object.

## Testing

Test utilities are in `src/test-utils/`:
- `mockCommandContext.ts` — `createMockCommandContext()` for command tests
- `render.tsx` — `renderWithProviders()` for Ink component tests

Run tests: `npx vitest run`
