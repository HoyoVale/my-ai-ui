# Local Platform 83

版本 83 将 79–82 的 Platform Kernel、Worktree、Multi-Agent、Integration 与 Review 能力接入一个可恢复的本地任务平台。

## 后台 Job

`PlatformJobScheduler` 管理持久化 Job。Job 的排队、运行、暂停、继续、失败、取消、重试、预算用量和日志都写入 Platform Journal；Snapshot 只用于快速启动。

应用重启时，处于 `running` 的 Job 会回到 `queued`，并以新的 attempt 继续。已完成和已取消 Job 不会重新执行；失败 Job 只有在未达到 `maxAttempts` 时才能重试。

当前 `delegate_tasks` 已接入 `delegation-workflow` Job：

1. Supervisor 执行 Worker 任务图。
2. Worker 使用独立模型、worktree 和 Tool Runtime。
3. Job 汇总模型 Token 与步骤用量。
4. Worker 全部完成后进入 Integration Coordinator。
5. Integrator、Reviewer 和安全发布完成后 Job 才能成功。

## 预算

Settings → Model 可配置 Worker 并发数，以及单次后台任务的 Token、步骤和时间预算。每个 Job 保存预算上限与实际用量；超过任一上限会中止本次执行并记录为失败。

## 资源租约

Worktree、Workspace、端口和测试进程共用 Platform Resource Lease。资源键示例：

- `worktree:<absolute-path>`
- `workspace:<absolute-path>`
- `port:4173`
- `test-process:electron-e2e`

独占资源冲突会阻止第二个任务启动；租约超时、Agent 结束或应用重启时会恢复或释放。

## UI 与命令

Input `/` 面板新增 `/agents`、`/tasks`、`/worktrees`、`/run`、`/review` 和 `/artifacts`。

Conversation 底部的“平台运行”默认只显示运行任务、等待审查和阻塞数量。展开后可操作后台 Job；开发者模式额外显示 Agent、Task、模型、worktree、branch、commit、租约、Artifact 和结构化日志。

## Windows CI 换行修复

Git 在 Windows Runner 上可能按 `core.autocrlf` 将工作树文本写为 `CRLF`。集成测试现在仅在读取文本断言时把 `CRLF` 规范化为 `LF`；Git tree、commit、branch、index 和 diff 的独立断言保持不变，因此不会掩盖集成或发布错误。

