# Ani

极简终端 AI 助手 — 单进程架构，本地优先。

## 快速开始

```bash
# 安装依赖
bun install

# 启动
bun run dev
```

首次启动会进入 Onboarding 引导，帮助录入岗位与项目信息。

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
      "apiKey": "ollama"
    }
  ]
}
```

## 架构

```
用户输入 → useAliceStream → LLMClient → Provider API → 工具执行 → 流式输出到 TUI
```

单进程运行，无 daemon。基于 Bun + Ink(React) + TypeScript。

### 老管家模型（Phase 2）

```
主 Agent（老管家）— 对话 · 调度 · 播报
        │ 任务指令（异步，不等待返回）
        ▼
编排器（Orchestrator）— 任务拆解 · 子任务依赖 · 重试
        │
        ▼
Sub-Agent（claude-code / codebuddy / trae-cli）— 实际执行
```

老管家始终在听，后台任务不阻塞对话。用户从"祈祷者"变回"决策者"。

## 斜杠命令

| 命令 | 说明 |
|------|------|
| `/tasks` | 查看后台任务列表 |
| `/tasks all` | 查看所有任务（含已完成） |

## 数据目录

```
~/.ani/
  settings.jsonc          # 用户配置
  users/{name}/           # 用户档案
  tasks/{task-id}/        # 后台任务数据
  inbox/                  # 任务完成/失败信号
  skills/                 # 技能插件
```

## 开发阶段

| Phase | 内容 | Tag |
|-------|------|-----|
| MVP | 单进程终端 AI 助手，最小对话循环 | v0.1.0 |
| Phase 1 | Onboarding 流程，Skills 能力 | v0.2.0 |
| Phase 2 | 老管家异步任务架构 | v0.3.0 |

## License

MIT
