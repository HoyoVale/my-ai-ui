# Execution Model 2.0 — Phase B

## Run 与 Execution Item 只读投影

版本基线：`my-ai-ui(102)`

Phase B 在 Phase A 契约之上新增统一的 Run 与 Item 投影层。它从现有 Conversation Message、Activity Event、Tool Record、Plan State、Checkpoint、Verification 和 Diff Summary 生成稳定的执行时间线，不引入第二套业务写入，也不修改 Conversation Store Schema。

## 1. 新增模块

```text
electron/execution-model/
├─ ExecutionItemProjector.js
├─ ExecutionItemSequence.js
└─ RunProjection.js
```

这些模块通过 `electron/execution-model/index.js` 统一导出。

## 2. ExecutionItemSequence

`ExecutionItemSequence` 负责：

- 为投影 Item 生成稳定 ID；
- 按 Run 内阶段和原始 Activity 顺序稳定排序；
- 为 Item 分配从 1 开始的连续 Sequence；
- 对 Activity Tool 与旧 `toolCalls` 等重复来源去重；
- 在重复候选中选择信息更完整的权威来源；
- 生成可用于 JSON 重载一致性检查的 Fingerprint；
- 检查重复 ID 和 Sequence 缺口。

排序分组固定为：

```text
User Message
→ Activity Events
→ Checkpoint / Verification / Diff
→ Assistant Final
```

同一 Activity 分组内部继续使用原始时间戳和 Event Sequence，不重新猜测工具执行顺序。

## 3. ExecutionItemProjector

`projectRunExecutionItems()` 接受一个明确的 `threadId` 与 `runId`，从已有权威记录投影以下 Item：

```text
user_message
assistant_commentary
assistant_final
plan_update
tool_call
command
file_change
diff
checkpoint
verification
error
status
```

投影原则：

- Command 只保存安全的 `displayCommand` 摘要；
- Tool Input、Output 和完整 Result 不复制到 Item；
- 大型 Tool Result 只保存 `resultRef`；
- 完整 Diff 仍由 `RunDiffTracker` 与 Message Diff Summary 管理；
- 完整 Plan 仍由 `PlanAuthority` 管理；
- Checkpoint 只保存有界摘要和引用；
- Developer-only Activity 保留 Developer Visibility；
- Tool Batch 可作为父 Item，Tool Item 保存 `parentItemId`；
- Activity 中已经存在的 Tool 不会再从旧 `toolCalls` 重复投影。

## 4. RunProjection

`projectRun()` 从一组 User/Assistant Message 生成：

- Run Identity；
- Thread、Conversation、Task 所有权；
- Run Sequence 与 Previous Run；
- Initial、Follow-up 或 Resume Relation；
- Run State、Outcome、Stop Reason 与 Resumable；
- Started/Ended/Duration；
- 有序 Item Timeline；
- Item Kind、Status、Visibility 统计；
- Item Fingerprint；
- 原始 Activity 和 Diff Revision 摘要。

`projectConversationRuns()` 按 Conversation Message 顺序生成同一 Thread 的 Run 列表。

Phase B 不会为没有 Thread 归属的历史会话伪造 Thread ID。历史数据必须由调用者显式提供迁移或诊断用 Thread ID，后续正式迁移由 Phase D 负责。

## 5. 现有状态映射

当前 Activity 投影为 Run State 的主要规则：

```text
completed                         → completed
checkpoint_ready / interrupted    → continuable
needs_input + 已结束或可恢复       → continuable
needs_input + 仍在运行             → waiting_input
failed / blocked + 可恢复          → continuable
failed / blocked + 不可恢复        → failed
cancelled / aborted               → cancelled
running / streaming               → running
```

投影只反映当前权威记录，不会擅自把状态冲突修正为成功。例如历史 Activity 保存为 Failed，即使最终正文声称测试通过，Run Projection 仍显示 Failed；这种冲突将供后续审计或一致性修复使用。

## 6. Provider 协议清洗补强

真实历史对话暴露了另一种 DSML 关闭格式：

```text
</｜｜DSML｜｜invoke>
</｜｜DSML｜｜tool_calls>
```

原清洗器主要覆盖：

```text
<｜｜DSML｜｜/tool_calls>
```

Phase B 同时补强 `PublicTextSanitizer`：

- 支持两种 DSML 关闭格式；
- 支持 `parameter` 标签；
- 流式清洗会根据外层 `tool_calls`、`function_calls`、`invoke` 或 `parameter` 选择对应结束标记；
- 遇到嵌套 Invoke 时不会在第一个 `</invoke>` 后提前恢复公开输出；
- Item 中的 Assistant Final 不再泄漏 DSML 参数或工具协议。

## 7. 真实对话样本验证

使用此前的黑洞项目压力测试对话进行旁路验证：

```text
Conversation Runs: 2
Run 1 Items:       47
Run 2 Items:       47
```

两个 Run 均满足：

- User Message 为第一个 Item；
- Assistant Final 为最后一个 Item；
- Sequence 连续；
- Thread/Run 所有权有效；
- JSON 重载前后 Fingerprint 一致；
- Activity Tool 与旧 Tool Call 无重复；
- DSML 无泄漏。

投影保留了样本中的真实状态冲突：第一轮仍为 Failed，第二轮为 Completed。这证明投影层没有通过最终文案覆盖权威 Activity 状态。

## 8. 架构边界

Phase B 仍是只读旁路层：

- `AgentRuntime` 未导入新 Projector；
- `ConversationManager` 未导入新 Projector；
- `PlatformKernel` 未导入新 Projector；
- UI 尚未切换到 Execution Item；
- Runtime 不写入 Item；
- Conversation Store 版本仍为 22；
- IPC 与用户交互行为不变。

Phase F 才会让 UI 消费统一 Run Projection。Phase D 才会持久化新的 Thread/Run Lineage。

## 9. 测试

新增：

```text
tests/execution-model/executionModelPhaseB103.test.js
```

新增命令：

```powershell
npm run test:phaseB-execution-projection
```

覆盖：

- 稳定 ID 与 Sequence；
- 候选输入顺序变化后的确定性；
- Tool 去重；
- Command/File Change 分类；
- Result Reference；
- 禁止复制 Raw Input/Output；
- Batch 父子关系；
- Plan、Checkpoint、Verification、Diff；
- Assistant Final 协议清洗；
- Run State 与 Relation；
- Conversation 多 Run 投影；
- JSON 重载 Fingerprint；
- 无 Thread 时 Fail Closed；
- Schema 与 Runtime 旁路边界。

Phase B 与 Phase A 专项共 29 项测试通过；Phase 1–4 相关回归共 170 项测试通过。

## 10. 下一阶段

Phase C 将新增统一 Thread Router、Thread Command、Routing Decision Store 和 Steering Queue，并以 Shadow Mode 对比新旧路由决策。在 Phase C 完成前，现有输入路由仍是生产权威。
