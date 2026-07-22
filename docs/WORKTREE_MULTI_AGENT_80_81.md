# Worktree Runtime 80 与 Multi-Agent 81

## 范围

本版本在 Platform Kernel 79 上增加可实际执行的隔离 Worker 平台：

`主模型 → delegate_tasks → Supervisor → Worker 模型 → 独立 worktree → checkpoint + handoff`

主模型继续负责用户会话、目标理解和最终回答；Worker 模型只处理 Supervisor 分配的结构化任务。两者可以来自不同 Provider，并拥有不同模型参数。

## 模型配置

在 `Setting → Model` 顶部配置：

- 主模型：当前会话默认使用的 Provider 与模型；Input 仍可为单个会话切换主模型。
- Worker 模型：所有子任务默认使用的独立 Provider 与模型。
- Worker 并发数：1–4，默认 2。

如果旧设置没有 Worker 选择，Worker 会安全地跟随当前主模型；一旦明确选择 Worker，主模型切换不会改变 Worker 路由。若 Worker 模型被删除，设置迁移会清除失效引用并回退到主模型。

## 调度与隔离

- 只有 Coding Goal 且绑定 Git 工作区时，主模型才能调用 `delegate_tasks`。
- 单次最多委派 4 个任务；默认最多同时运行 2 个 Worker。
- 没有依赖的任务可以并行；依赖任务必须等待所有前置任务完成。
- 每个 Worker 拥有独立分支、worktree、Tool Session 和结果存储。
- Worker 不能创建子 Agent。
- 只读角色发生文件修改时，Supervisor 会拒绝该执行结果。
- Worker 失败最多按任务的 `maxAttempts` 重试；达到上限后保存为可继续状态。

## 用户脏工作区

平台不会自动提交或清理用户当前分支。它使用临时 Git index 生成隔离基线，其中包含：

- 当前 HEAD；
- staged 修改；
- unstaged 修改；
- 未被 `.gitignore` 排除的未跟踪文件。

临时基线只用于 Worker 分支，不更新用户分支、真实 index 或工作目录。Worker 输出会保存为 checkpoint commit；worktree 回收后仍保留分支，因此下一阶段 Integrator 可以安全消费。

## npm 安装与安全

推荐：

```powershell
npm ci
npm audit
npm run check
```

不要再次执行 `npm audit fix --force`。本版本已经：

- 使用 `@modelcontextprotocol/sdk ^1.29.0`；
- 将其传递依赖 `@hono/node-server` override 到 `2.0.11`；
- 重新生成 `package-lock.json`。

因此全新 `npm ci` 后 `npm audit` 应返回 `found 0 vulnerabilities`。如果本机仍显示旧版，请先确认当前目录的 `package.json` 和 `package-lock.json` 已被本版本覆盖，再重新执行 `npm ci`。

## 下一阶段边界

80、81 产出的是隔离 commit 和结构化 handoff，但不会自动合并到用户分支。82 将增加 Integrator、集成队列、冲突任务、最终集成 worktree 和独立 Reviewer 完成门。
