# Tool Runtime 终极重构：第三阶段实现报告

## 阶段目标

第三阶段完成“协议收口与真实恢复”，对应六项任务：

1. Journal Schema V2
2. Checkpoint 恢复游标
3. Run 级恢复状态
4. 全局启动 RecoveryManager
5. Snapshot 损坏重建
6. Schema migration 测试

## 1. Journal Schema V2

新增：

- `RuntimeJournalSchema.js`
- `runtimeIntegrity.js`

每条新 Journal 事件现在包含：

- `version: 2`
- `eventId`
- `sequence`
- `timestamp`
- `taskId / runId / workspaceId`
- `segmentId / stepId / callId`
- `type`
- `actor`
- `reason`
- `durability: critical | normal`
- `payload`
- SHA-256 完整性校验

兼容行为：

- V1 事件读取时自动迁移为 V2 内存结构。
- V2 事件校验失败时跳过，不污染恢复状态。
- 截断 JSONL 末行仍会被忽略，其前后的有效记录继续恢复。
- 关键 Run、Segment、Tool、Checkpoint 事件执行同步落盘；普通诊断事件可以使用普通耐久级别。

## 2. Checkpoint V3 与恢复游标

Checkpoint 升级为 `version: 3`，新增：

- `journalSequence`
- `journalChecksum`
- `committedSegmentId`
- `reportedReceiptIds`
- `unresolvedCallIds`
- `snapshotSource`
- SHA-256 完整性校验

游标由 `ToolExecutionLedger.recoveryCursor()` 统一生成，避免 Agent、Tool Runtime 和持久化层分别推断恢复位置。

Segment 提交流程调整为：

```text
SEGMENT_COMMITTED 写入 Journal
→ 读取最新恢复游标
→ 持久化 Checkpoint
```

因此 Checkpoint 能明确指向已经提交的 Segment，而不是保存提交前的旧位置。

## 3. Run 级恢复状态

`RunStateMachine` 新增正式恢复结果：

- `needs_reconciliation`
- `needs_confirmation`
- `unknown`

并新增对应展示阶段：

- `reconciling`
- `needs_confirmation`
- `unknown`

当 Tool Runtime 存在未确认副作用时，Run 不再统一降级为普通 `interrupted`，而是保留真实恢复状态。

`AgentRuntime.finalizeRun()` 现在会在结束前读取 Tool Runtime 恢复快照。即使普通执行流程准备报告完成，只要仍存在未解决工具副作用，最终 Run 状态会自动提升为核验或确认状态。

## 4. 全局启动 RecoveryManager

新增：

- `RuntimeRecoveryManager.js`

应用启动顺序现在是：

```text
Electron ready
→ 扫描 tool-results/*/runtime
→ 加载并迁移 Journal
→ 清理已经过期的 Lease
→ 将不确定 Tool Call 固化为恢复状态
→ 验证或重建 Checkpoint
→ 生成 Run 恢复决策
→ 更新 Conversation 持久化活动
→ 创建窗口
```

恢复决策包括：

- `phase`
- `outcome`
- `activityStatus`
- `messageStatus`
- `stopReason`
- `resumable`
- Tool Runtime 公开恢复快照
- 恢复后的 Checkpoint

RecoveryManager 不会自动重放不确定写操作，也不会移除其他仍未过期执行器持有的 Lease。

## 5. Snapshot 损坏重建

`RuntimeCheckpointStore` 新增：

- `loadDetailed()`
- checksum 校验
- owner 校验
- `quarantine()`
- V1/V2 → V3 migration

当 `checkpoint.json` 出现以下问题时：

- JSON 截断
- checksum 不匹配
- 内容损坏

系统会：

```text
将损坏文件改名隔离
→ 查找 Journal 中最后一条 CHECKPOINT_STORED
→ 从内嵌紧凑 Checkpoint 重建
→ 若旧 Journal 没有快照，则从 Run/Segment/Receipt 状态合成最小 Checkpoint
→ 写入新的 V3 Checkpoint
→ 记录 CHECKPOINT_REBUILT
```

## 6. Conversation 恢复投影

`ConversationManager.recoverInterruptedRuns()` 现在可以接收 RuntimeRecoveryManager 的任务级决策。

普通中断仍显示“执行被中断”；不确定工具副作用则显示：

- 有工具操作需要核验
- 有工具操作需要确认

对应工具事件使用 `attention` 状态，而不是被错误标记为 `cancelled`。

恢复状态会同步写入：

- Assistant message status
- Activity status / outcome / resumable
- Status event
- Tool event runtime recovery 信息
- Checkpoint V3

## Schema migration 测试

新增测试：

- V1 Journal → V2
- 损坏 V2 Journal checksum 拒绝加载
- V2 Checkpoint → V3
- Checkpoint 损坏后从 Journal 重建
- 全局 RecoveryManager 扫描不确定远程写操作
- Conversation 将不确定工具显示为 attention
- RunStateMachine 提升为 run-level recovery state

## 验证结果

```text
Lint: 0 errors, 0 warnings
Node tests: 359 passed, 0 failed
Vite build: success
Runtime crash recovery E2E: passed
```

完整 Playwright Electron E2E 在当前容器中未启动成功，原因是 Electron 二进制下载 `fetch failed`。这不是项目测试断言失败；Windows/Linux GitHub Actions 仍需验证启动恢复对真实 Electron 生命周期的影响。

## 本阶段修改范围

核心新增文件：

```text
electron/tools/runtime-state/
├─ RuntimeCheckpointSchema.js
├─ RuntimeJournalSchema.js
├─ RuntimeRecoveryManager.js
└─ runtimeIntegrity.js
```

核心修改文件：

```text
electron/main.js
electron/agent/AgentRuntime.js
electron/agent/RunStateMachine.js
electron/agent/runCheckpoint.js
electron/conversation/ConversationManager.js
electron/tools/createAgentToolSession.js
electron/tools/runtime-state/DurableRuntimeJournal.js
electron/tools/runtime-state/RuntimeCheckpointStore.js
electron/tools/runtime-state/ToolCallStateMachine.js
electron/tools/runtime-state/ToolExecutionLedger.js
electron/tools/runtime-state/ToolLeaseStore.js
```

## 第三阶段完成度

第三阶段列出的六项工作已经落地并通过 Node 测试。下一阶段应进入“增量 IPC 与 UI 收口”：

- Text Chunk、Status Patch、Snapshot 分通道
- Renderer 断线重订阅
- Developer details 按需加载
- Recovery Center 历史任务入口
- IPC 背压与长任务压力测试
