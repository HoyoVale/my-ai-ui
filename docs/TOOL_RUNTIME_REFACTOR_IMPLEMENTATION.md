# Tool Runtime 终极重构：实现状态与迁移说明

## 1. 本轮目标

本轮把 Tool Runtime 从“执行完再尽量记录”的运行模型，迁移为“先准备、后执行、先落收据、再报告”的可恢复模型。核心目标不是承诺所有外部写操作都 exactly-once，而是保证：

- 已经持久化收据的工具不会重复执行；
- 安全读取和具备幂等键的写入可以按契约恢复；
- 状态不确定的远程写入不会被盲目重放；
- 模型只消费已经持久化的工具结果；
- UI 是运行状态的投影，不是 Runtime 的权威状态；
- 普通模式保留可理解的工具流，开发者模式才暴露诊断细节；
- 长任务的内存、IPC 和结果目录保持有界。

## 2. 已落地架构

### 2.1 工具运行契约

每个 Tool 现在具有标准化运行契约：

- `effect`: `read | local_write | remote_write | destructive`
- `retryMode`: `safe | idempotency_key | reconcile_before_retry | manual_only`
- `supportsAbort`
- `supportsResume`
- `timeoutMs`
- `leaseTtlMs`
- `heartbeatMs`
- 可选 `reconcile / verify / compensate`

旧 Tool 不需要一次性重写。`ToolRegistry` 会根据原有 side-effect、retry 与 idempotency 元数据生成保守契约；新写工具应显式声明契约。

### 2.2 Tool Call 状态机

执行状态采用以下主路径：

```text
planned
  -> prepared
  -> dispatched
  -> effect_confirmed
  -> receipt_stored
  -> reported
```

异常路径包括：

```text
failed
cancel_requested
cancelled
unknown
needs_reconciliation
needs_confirmation
```

非法状态回退会被状态机直接拒绝。例如 `receipt_stored` 不能回到 `dispatched`，`reported` 不能再次进入执行态。

### 2.3 Journal、Receipt、Lease 与 Checkpoint

`ToolExecutionLedger` 统一协调四类持久化对象：

- `DurableRuntimeJournal`：追加式运行事件，支持 fsync 和截断 JSONL 恢复；
- `ToolReceiptStore`：原子写入结果收据，按 callId 和 idempotencyKey 查找；
- `ToolLeaseStore`：执行所有权、心跳和过期检测；
- `RuntimeCheckpointStore`：任务检查点原子替换和 owner 校验。

每次工具执行的关键顺序为：

```text
写 TOOL_PREPARED
  -> 获取 Lease
  -> 写 TOOL_DISPATCHED
  -> 执行 Tool
  -> 写 Receipt
  -> 写 TOOL_RECEIPT_STORED
  -> 将结果交给模型
  -> 写 TOOL_REPORTED
```

因此，应用在“收据已写入、模型尚未消费”之间崩溃时，重启后会重放收据，而不是再次执行工具。

### 2.4 恢复分类

启动或继续同一 Task 时，Ledger 会根据状态和工具契约分类：

- `replay_receipt`
- `safe_to_dispatch`
- `safe_to_retry`
- `retry_with_idempotency_key`
- `needs_reconciliation`
- `needs_confirmation`

远程写操作发生超时、取消或执行器失联时，不再简单标记为 cancelled。若无法确认副作用，会进入核验或确认状态。

### 2.5 Segment 与 Run Journal

Agent 现在记录：

- `RUN_STARTED`
- `MODEL_STEP_STARTED / MODEL_STEP_COMPLETED`
- `SEGMENT_STARTED / SEGMENT_COMMITTED`
- `CHECKPOINT_STORED`
- `RUN_COMPLETED / RUN_INTERRUPTED / RUN_CANCELLED / RUN_FAILED`

Segment 提交后会保存 Runtime Checkpoint。模型流本身不做 token 级续跑；恢复边界是上一个稳定 Segment/Checkpoint。

## 3. UI 信息边界

### 3.1 普通用户可见

普通模式继续显示真实 Tool 流，不会因为关闭开发者模式而消失：

- 当前公开进度说明；
- 工具名称、目标摘要、运行状态和耗时；
- Plan 及完成进度；
- 成功、失败、取消；
- “需要核验”或“需要确认”的安全提醒；
- 可继续任务的检查点状态。

普通 IPC 投影只保留有限的目标字段和结果摘要，不传输：

- 原始 Tool Input/Output；
- 大结果 Preview 与内部引用详情；
- idempotencyKey；
- lease owner、journal payload、checksum；
-堆栈、Provider 原始错误和内部 Runtime 状态事件。

### 3.2 开发者模式额外可见

开发者模式只提高诊断可见性，不改变 Tool 权限和执行策略：

- callId、runId、segmentId、taskId；
- 原始但已脱敏的 Tool Input/Output/Result/Meta；
- Tool Runtime Contract；
- Tool Call State；
- attempt、Lease、Receipt、Journal 与恢复判定；
- 内部运行状态、错误码和检查点诊断。

### 3.3 权威状态与 UI 投影

权威状态来自 Journal、Receipt、Lease 和 Checkpoint。`RunActivityStore` 仅负责生成 Conversation、Response 和活动面板使用的用户投影。

普通模式和开发者模式共享同一个 Runtime，不允许出现：

- 开发者模式关闭后 Tool 不执行；
- 普通模式 Tool 流消失；
- UI 动画状态反向改变 Runtime；
- 关闭窗口导致工具被判定完成或取消。

## 4. 长任务容量治理

### 4.1 IPC 合并

Agent 状态广播使用 40ms 合并窗口。同一时间内多个文本 chunk、工具事件和 Plan 更新只发送最新快照。终止态与最终快照使用立即发送，避免最后一份活动状态丢失。

### 4.2 Activity 有界投影

`RunActivityStore` 默认最多保留 600 个实时事件，并优先保护：

- Run 状态；
- 当前活动 Batch；
- 最新 Plan；
- queued/running/retrying/attention Tool。

被省略数量由 `eventsOmitted` 记录。完整工具生命周期仍在 Runtime Journal 中。

### 4.3 Tool Event 内存上限

`ToolEventStore` 的内存投影默认最多保留 5000 条事件；磁盘 JSONL 继续保持 append-only。序号不因内存裁剪而重置。

### 4.4 Tool Result 配额

大型结果目录具备：

- 时间保留策略；
- 最大持久条目数；
- 最大持久字节数；
- oldest-first 配额清理；
- task/workspace/segment owner 隔离。

配额清理是 best-effort，不会反向把已经成功的 Tool 调用变成失败。

## 5. 现有代码迁移关系

| 原模块 | 新职责 |
|---|---|
| `ToolRegistry` | 冻结工具清单并标准化 Runtime Contract |
| `ToolExecutor` | 校验、授权、预算、执行以及 Ledger 状态迁移 |
| `ToolEventStore` | 兼容 UI 生命周期记录与有界内存投影 |
| `ToolResultStore` | 大结果分页、owner 隔离与磁盘配额 |
| `ToolExecutionLedger` | Tool Call 权威状态、Receipt/Lease/Recovery |
| `AgentRuntime` | Run/Segment 边界、Checkpoint、状态广播 |
| `RunActivityStore` | 用户活动投影，不承担权威执行状态 |
| `Conversation / Response` | 消费公开活动与恢复提醒 |

旧的 Tool 定义可继续工作，但写工具应逐步补齐显式契约、reconcile 和 verify。

## 6. 当前仍需后续完成的部分

本轮已经完成持久化协议、状态机、收据重放、自动核验入口、公开/开发者投影、IPC 合并与容量治理。后续阶段仍包括：

1. Recovery Center 的交互动作：重新核验、确认已生效、确认未生效、放弃该操作；
2. 远程 Provider 与 Tool 级 circuit breaker；
3. 子进程 Tool 的进程组终止和强制 kill；
4. Runtime Journal 文件滚动、manifest 与全局 workspace 配额；
5. 1000+ Tool 事件和长时间运行的性能基准；
6. 在真实 Electron 环境中的崩溃注入 E2E。

这些功能应继续按独立 PR 落地，不能把 UI 操作和核心状态机重新耦合。

## 7. 测试结果与新增覆盖

新增或加强的测试覆盖：

- Tool Call 状态机不变量；
- Receipt 先于模型报告；
- 重启后 Receipt 重放；
- 远程写超时进入 reconciliation；
- reconcile 后生成可重放 Receipt；
- Journal 截断记录恢复；
- Runtime Checkpoint owner 与内容清理；
- 普通/开发者 IPC 投影边界；
- 状态广播合并与终止态立即发送；
- Activity 和 Tool Event 有界投影；
- Tool Result 配额清理；
- 取消时不确定副作用升级为 interrupted。

当前 Core 验证：

```text
Lint: 0 errors, 0 warnings
Node tests: 346 passed, 0 failed
Vite build: passed
```

当前容器无法下载 Electron 二进制，因此 Playwright Electron E2E 未在本地执行；GitHub Actions 的 Windows/Linux Electron Runner 仍是最终 E2E 验证环境。
