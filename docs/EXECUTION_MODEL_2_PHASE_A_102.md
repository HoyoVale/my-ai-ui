# Execution Model 2.0 — Phase A 实施说明

## 目标

Phase A 只建立架构契约，不接管现有生产路由。

本阶段固定：

- Thread 生命周期；
- Run 身份、状态与血缘；
- Execution Item 索引 Schema；
- Start、Resume、Steer、Fork、Regenerate 的 Routing Decision；
- 跨模块权威状态与架构不变量。

## 新增模块

```text
electron/execution-model/
├─ ExecutionModelContract.js
├─ ThreadStateMachine.js
├─ RunIdentityContract.js
├─ ExecutionItemSchema.js
├─ ThreadRoutingDecision.js
└─ index.js
```

### ExecutionModelContract

定义：

- Execution Model 版本；
- Conversation、Thread、Run、Item、Goal、Platform Run 等实体定位；
- 唯一状态权威；
- 架构不变量；
- Thread、Run、Item 所有权校验。

### ThreadStateMachine

定义状态：

```text
created
active
running
waiting
continuable
completed
failed
cancelled
archived
```

支持：

- 合法转换检查；
- Revision 乐观锁；
- 状态转换审计；
- archived 终态保护。

### RunIdentityContract

定义状态：

```text
queued
preparing
running
waiting_approval
waiting_input
finalizing
completed
continuable
failed
cancelled
```

定义关系：

```text
initial
follow_up
resume
retry
regenerate
fork
```

支持：

- Run 创建与清洗；
- 终态不可重开；
- Retry、Regenerate、Fork 血缘验证；
- Thread 与 Sequence 一致性。

### ExecutionItemSchema

提供轻量索引：

- 有序 sequence；
- Run 或 Thread Scope；
- Kind、Status 与 Visibility；
- sourceType/sourceId；
- 有界 summary/resultRef；
- failed → superseded/resolved。

不会复制：

- 原始 input；
- 原始 result；
- 原始 output；
- 大型 Tool Result。

### ThreadRoutingDecision

定义：

```text
start
resume
steer
fork
regenerate
```

支持：

- Proposed、Applied、Rejected；
- 显式、Active Thread、Active Run、语义兜底、恢复、Shadow 来源；
- Steering Active Run 约束；
- Fork 与 Regenerate 目标唯一性；
- Legacy/New Decision Shadow 差异记录；
- 有界 Evidence，不保存原始消息内容。

## 未改变内容

本阶段没有修改：

- AgentRuntime；
- Existing ExecutionThread；
- Existing RunStateMachine；
- ConversationManager；
- Conversation Store Schema；
- IPC；
- UI；
- Provider 请求；
- Tool Runtime；
- Platform Runtime。

## 测试

新增：

```text
tests/execution-model/executionModelPhaseA102.test.js
```

新增命令：

```powershell
npm run test:phaseA-execution-model
```

测试覆盖：

- 权威状态与不变量；
- Thread Revision；
- Thread 合法转换；
- Run 终态不可重开；
- Run 血缘；
- Item Scope；
- Item 大结果隔离；
- 失败被后续证据 supersede；
- Start、Steer、Fork、Regenerate 路由约束；
- Shadow mismatch；
- Phase A 未接管生产 Runtime；
- 新模块无反向 Facade 依赖。

## 验证结果

```text
Phase A Execution Model：18/18
Phase 1 Execution Consistency：39/39
Phase 2 AgentRuntime：25/25
Phase 3 Core Runtime：71/71
Phase 4 Conversation UI：33/33
```

静态验证：

- 所有新增 JavaScript 文件通过 `node --check`；
- Package JSON 可解析；
- 新模块未导入 Agent、Conversation 或 Platform Facade；
- 现有生产 Runtime 未导入 `electron/execution-model/`；
- Conversation Store Schema 与数据版本未变化。

当前容器中的复用 `node_modules` 不包含可执行的 Oxlint/Vite 入口，且部分顶层依赖目录缺少包内容，因此没有在此环境宣称完整 `npm test`、lint 和 build 通过。本机完整依赖环境应继续运行 `npm run check:full`。
