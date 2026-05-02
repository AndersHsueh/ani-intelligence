# Alice 项目分析

## 概述

**ALICE** — Accelerated Logic Inference Core Executor（加速逻辑推理核心执行器），是一个基于大语言模型的命令行 AI 办公助手，Node.js + TypeScript + Ink (React for CLI) 技术栈。

版本：v0.5.10

## 双组件架构

| 组件 | 角色 | 入口 | 说明 |
|------|------|------|------|
| **ALICE** (CLI) | 前端 TUI | `src/index.tsx` → `bin.alice` | 用户交互界面，基于 Ink 6 + React 19 的终端 UI |
| **VERONICA** (daemon) | 后端服务 | `src/daemon/index.ts` → `bin.veronica` | 常驻后台进程，管理 LLM 通信、会话、工具执行、通道网关 |

通信方式：CLI 通过 `DaemonClient`（`src/utils/daemonClient.ts`）与 daemon 通信，支持 HTTP/stdio 两种 transport。

## 核心功能

### 1. TUI 界面
- 从 qwen-code 移植了生产级 Ink/React 终端界面
- 通过 `src/shim/qwen-code-core.ts`（51722 字节）适配层，将 qwen-code TUI 对接 Alice 自己的 daemon 后端
- 支持：代码高亮、Markdown 渲染、工具调用可视化、Vim 模式、多主题、会话管理
- `useAliceStream`：流式适配器，将 daemon 的 `ChatStreamEvent` 映射到 TUI 的消息历史

### 2. 多 LLM 后端
- `src/core/providers/` 目录下 Provider 模式适配
- 支持：LM Studio、Ollama、OpenAI、Anthropic、Google Gemini、Qwen
- 配置通过 `~/.alice/settings.jsonc` 管理（`src/utils/config.ts`）

### 3. Function Calling 工具系统
- `src/tools/builtin/`：14 个内置工具
  - `readFile`、`writeFile`、`editFile` — 文件操作
  - `executeCommand` — 命令执行（带安全确认）
  - `listFiles`、`searchFiles` — 文件搜索
  - `getCurrentDirectory`、`getCurrentDateTime` — 环境信息
  - `getGitInfo` — Git 仓库信息
  - `TodoWrite`、`TodoRead` — 会话任务清单
  - `loadSkill` — 技能加载
  - `askUser` — 向用户提问
  - `sequentialThinking` — 序列化思考
- `src/services/CommandService.ts` — 命令服务

### 4. 飞书/Lark 通道
- daemon 启动时建立飞书 WebSocket 长连接（`src/daemon/gateway/feishuWsRunner.ts`）
- `src/daemon/gateway/feishuAdapter.ts` — 飞书消息适配
- 支持文本和富文本（post）消息解析
- 消息去重、敲键盘 reaction 反馈
- 配置：`defaultChannel: feishu`，飞书凭据通过环境变量或 `daemon_settings.jsonc` 提供

### 5. 智能降级
- `src/core/llm.ts`：LLMClient 内置 fallback provider
- 主模型故障时自动切换到最快的备用模型
- 模型测速：`alice --test-model`

### 6. 会话管理
- daemon 持有会话与消息列表（权威数据源）
- CLI 侧 `sessionManager` 用于本地持久化与统计
- 每次 `done` 事件时用服务端下发的消息更新本地 state

### 7. 心跳与任务系统
- daemon 的心跳循环：`src/daemon/index.ts` → `scheduleHeartbeat`
- 自适应间隔：有执行中任务时 60s，否则按配置
- 占位任务、超时检查、过期任务修复

## 两种运行模式

- **交互式 TUI**（`alice` 命令）：启动完整 Ink/React 终端界面
- **一次性模式**（`alice -p "prompt"`）：直接流式输出到 stdout，适合脚本调用

## Agent 产品体系

| 名称 | 全称 | 角色 | 状态 |
|------|------|------|------|
| **VERONICA** | Verified Embedded Resilient Orchestration Neural Intelligent Control Agent | daemon 服务，常驻运行、会话与推理编排 | 已上线 |
| **ALICE** | Accelerated Logic Inference Core Executor | 主 CLI（TUI + 一次性对话） | 已上线 |
| **DIANA** | Dynamic Intelligent Accessible Networked Agent | 移动端 Agent | 规划中 |
| **ANDERS** | Architectural Nexus Disciplined Engineering Reasoning System | 架构师 Agent，处理复杂代码 | 规划中 |

## 目录结构

```
alice-cli/
├── src/
│   ├── index.tsx           # CLI 入口
│   ├── shim/               # qwen-code TUI 适配层
│   │   ├── qwen-code-core.ts   # 核心 shim（51KB）
│   │   └── ...
│   ├── ui/                 # React/Ink TUI 组件
│   ├── core/               # 核心逻辑
│   │   ├── llm.ts          # LLM 客户端（含降级）
│   │   ├── providers/      # Provider 适配器
│   │   ├── session.ts      # 会话管理
│   │   ├── events.ts       # 事件系统
│   │   ├── errorHandler.ts # 错误处理
│   │   ├── daemonRetry.ts  # Daemon 重试
│   │   └── ...
│   ├── daemon/             # VERONICA 后台服务
│   │   ├── index.ts        # daemon 入口
│   │   ├── routes.ts       # 路由
│   │   ├── server.ts       # HTTP/stdio 服务器
│   │   ├── gateway/        # 飞书通道网关
│   │   ├── modelRegistry.ts # 模型注册表
│   │   └── ...
│   ├── tools/builtin/      # 内置工具
│   ├── services/           # 业务服务层
│   ├── utils/              # 工具函数
│   └── types/              # TypeScript 类型定义
└── package.json            # 依赖：ink, react, commander, etc.
```

## 技术栈

- **运行时**：Node.js >= 18，ESM 模块
- **语言**：TypeScript (strict mode, ES2022 target)
- **TUI**：Ink 6 + React 19
- **CLI 框架**：Commander
- **LLM 集成**：多种 provider 适配（OpenAI SDK, Anthropic SDK, Google GenAI, undici 直连）
- **飞书**：@larksuiteoapi/node-sdk
- **MCP**：@modelcontextprotocol/sdk
- **ACP**：@agentclientprotocol/sdk
- **构建**：tsc，dist/ 目录输出

## 配置边界

- **`~/.alice/settings.jsonc`**：模型、UI、工作区、键绑定等，供 CLI 与 daemon 共用
- **`~/.alice/daemon_settings.jsonc`**：daemon 进程的 transport、socket 路径、心跳、日志、飞书通道配置
