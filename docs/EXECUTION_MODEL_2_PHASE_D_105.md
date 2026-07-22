# Execution Model 2.0 — Phase D

## 持久化、迁移与崩溃恢复

基线：`my-ai-ui(104)`  
目标版本：Conversation Store v23

## 1. 目标

Phase D 将 Phase A–C 中已经定义和旁路验证的 Thread、Run 与 Routing 概念写入持久化层，同时保持新 Router 为 Shadow Mode。

本阶段解决：

- 新任务覆盖旧 `conversation.executionThread`；
- 应用重启后 Thread 路由诊断丢失；
- Run 只有 `lastRunId`，缺少可审计血缘；
- Provider Continuation 无持久化位置；
- Windows 原子替换在主文件删除、临时文件尚未重命名时无法恢复；
- Regenerate Run 没有写入 Thread Run Lineage。

## 2. Store v23

Conversation 新增权威字段：

```text
activeExecutionThreadId
executionThreads[]
routingDecisions[]
```

保留兼容字段：

```text
executionThread
```

`executionThread` 始终是 `activeExecutionThreadId` 对应 Thread 的投影。旧 Runtime、UI 和 IPC 可以继续读取它，但新持久化权威是 `executionThreads[]`。

## 3. Thread v2

Thread 新增：

```text
revision
runs[]
forkedFromThreadId
forkedFromRunId
providerContinuation
```

每个 Thread 最多保留 120 个 Run Identity，每个 Conversation 最多保留 48 个 Thread。

旧 v1 Thread 若只有 `lastRunId`，迁移时会合成一条初始 Run：

- active/running → running；
- waiting/resumable → continuable；
- completed → completed；
- failed → failed；
- cancelled → cancelled。

## 4. Run Lineage

Run Identity 保存：

```text
id
threadId
sequence
state
relation
userMessageId
previousRunId
retryOfRunId
regeneratedFromRunId
forkedFromThreadId
forkedFromRunId
createdAt
updatedAt
terminalAt
```

支持：

```text
initial
follow_up
resume
retry
regenerate
fork
```

终态 Run 不会被重新打开。继续、重试和重新生成都创建新的 Run Identity。

## 5. Regenerate 修正

重新生成现在：

- 复用目标消息绑定的 Execution Thread；
- 复用原 Thread 的 Task ID；
- 创建新的 Run ID；
- 保存 `relation: regenerate`；
- 保存 `regeneratedFromRunId`；
- 继续保留旧 Run。

## 6. Provider Continuation

Thread 可选保存：

```text
providerId
modelConfigId
responseId
compatible
createdAt
updatedAt
```

它只是模型上下文优化，不是应用恢复权威。

- Provider Continuation 无效时，Thread、Plan、Checkpoint 和 Tool Evidence 仍可恢复；
- 会话切换到不同 Provider/Model 时，不兼容 Continuation 会自动清除；
- Phase D 只提供持久化与管理接口，不把 Response ID 接入模型请求。

## 7. Routing Decision 持久化

Phase C 的 Shadow Decision 现在同时保存到 Conversation：

```text
routingDecisions[]
```

最多保留 200 条，记录：

- start/resume/steer/fork/regenerate/reject；
- legacyAction；
- mismatch；
- Thread/Run/Message 引用；
- 有界 reason/evidence。

不保存原始用户消息正文。

应用重启后，持久化 Decision 会重新装载到 `ThreadRoutingDecisionStore`，开发者诊断继续可见。

## 8. 崩溃恢复

启动恢复会扫描 Conversation 中全部 Thread，而不仅是当前兼容字段。

所有处于：

```text
active
running
```

的 Thread 会恢复为：

```text
waiting
resumable: true
stopReason: interrupted
```

对应最后 Run 恢复为：

```text
continuable
```

恢复过程不会自动启动新的 Run，也不会重放写操作。真实 Tool Side Effect 仍由现有 Tool Receipt、Journal 与 Reconciliation 管理。

## 9. 原子文件恢复

`ConversationStore.load()` 现在会按顺序读取：

1. 正式文件；
2. 若正式文件缺失或损坏，尝试 `.tmp`；
3. `.tmp` 有效则恢复并重新提交正式文件；
4. 两者均不可用才创建空 Store。

这覆盖 Windows 替换流程中：

```text
旧正式文件已删除
新临时文件尚未 rename
应用崩溃
```

的恢复窗口。

## 10. Shadow Mode 保持不变

本阶段没有启用：

- Steering Queue 注入；
- 新 Router 执行 Start/Resume/Fork；
- Execution Item 作为 UI 数据源；
- Provider Response ID 自动续接；
- 多 Thread UI。

Legacy Router 仍是生产权威。Phase D 只是让新模型的数据可持久化、可恢复、可审计。

## 11. 修改模块

```text
electron/agent/ExecutionThread.js
electron/agent/preparation/AgentRunPreparation.js
electron/conversation/ConversationManager.js
electron/conversation/ConversationStore.js
electron/conversation/conversationSchema.js
electron/conversation/services/ConversationExecutionService.js
electron/conversation/services/ConversationStateService.js
electron/execution-model/ExecutionPersistence.js
electron/execution-model/ExecutionThreadRouter.js
electron/execution-model/RunProjection.js
electron/execution-model/index.js
```

## 12. 测试

新增：

```text
tests/execution-model/executionModelPhaseD105.test.js
npm run test:phaseD-execution-persistence
```

覆盖：

- v22 → v23 迁移；
- 多 Thread 保留与 Active Thread；
- Run Lineage；
- Regenerate Lineage；
- Provider Continuation；
- Routing Decision 持久化与重载；
- 全部 Running Thread 的崩溃恢复；
- `.tmp` 中断替换恢复；
- Shadow Mode 不变。
