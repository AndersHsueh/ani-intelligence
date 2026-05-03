---
name: git-commit
description: 生成规范的 git commit 消息。当用户需要提交代码、写 commit message、描述代码变更、或问如何提交时使用。
---

# Git Commit 规范

使用 **Conventional Commits** 格式生成 commit 消息。

## 格式

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

- **type**：变更类型（必填）
- **scope**：影响范围，如模块名或文件名（可选）
- **subject**：简短描述，50 字以内，动词开头，不加句号（必填）
- **body**：详细说明，解释 *为什么* 而非 *做了什么*（可选）
- **footer**：关联 issue、breaking changes 等（可选）

## 变更类型

| type | 含义 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 仅文档变更 |
| `style` | 格式调整（不影响逻辑） |
| `refactor` | 重构（不是新功能也不是修复） |
| `test` | 添加或修改测试 |
| `chore` | 构建过程、工具配置等杂项变更 |
| `perf` | 性能优化 |
| `ci` | CI/CD 配置变更 |
| `revert` | 回滚某个 commit |

## 写法原则

1. subject 用祈使句，英文用动词原形（如 `add`, `fix`, `update`），中文直接描述
2. subject 不超过 50 个字符（中文不超过 25 字）
3. body 说明变更动机，而非重复 subject
4. Breaking change 在 footer 以 `BREAKING CHANGE:` 开头

## 示例

**英文**：
```
feat(auth): add OAuth2 login support

Implements Google and GitHub OAuth2 providers.
Users can now sign in without creating a password.

Closes #42
```

**中文**：
```
fix(session): 修复多轮对话上下文丢失问题

每次提交消息时重置 session 导致历史消息无法传递给 LLM。
改为懒初始化，并在 done 事件中同步完整对话记录。

Fixes #IJKS04
```

**简短变更**：
```
chore: update dependencies
docs: fix typo in README
style: format with prettier
```

## 生成步骤

1. 先用 `git diff --staged` 或 `git status` 了解变更内容
2. 根据变更性质选择 type
3. 用一句话概括 subject（动词 + 对象 + 简要说明）
4. 变更复杂时补充 body 说明动机
5. 有关联 issue 时在 footer 添加 `Closes #N`
