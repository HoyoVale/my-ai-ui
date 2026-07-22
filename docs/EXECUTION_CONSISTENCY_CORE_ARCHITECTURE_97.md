# Execution Consistency & Core Architecture 1.0

## 目标

本阶段在不重写 Agent 主循环的前提下，抽离第一批权威边界，并修复压力测试发现的五项执行一致性问题：

1. 普通 Coding 任务收到“继续”后错误创建新任务；
2. 早期工具失败已被后续成功解决，但 Run 仍被判定失败；
3. DSML、XML 或 JSON 工具协议进入公开回复；
4. 内部子计划全部完成后，顶层步骤仍保持进行中；
5. 工具错误分类、Plan Authority 和最终状态判断散落在多个 Runtime 文件中。

## 新模块

### `ExecutionThread.js`

为没有显式 Goal 的普通 Chat/Coding 工作建立持久化任务线程，保存：

- 稳定 `threadId` 与 `taskId`；
- 当前目标描述；
- 根计划与 Working State；
- 最近 Run、Checkpoint 和 Assistant 消息；
- 连续执行次数；
- 中断恢复和最终状态。

明确“新任务”时创建新 Thread；“继续”、活跃任务反馈和可恢复等待默认复用原 Thread。普通任务不再伪造 Goal ID。

### `RunOutcomeResolver.js`

统一解析 Run 的有效停止原因和最终 Outcome。它结合：

- 当前 Plan 状态；
- Goal Verification；
- 已解决与仍活跃的工具错误；
- graceful boundary；
- 公开 Final Text。

早期测试失败后，同一测试脚本后续成功会把旧失败标记为 resolved，不再污染最终状态。

### `PublicTextSanitizer.js`

在三层边界清理 Provider 工具协议：

- 模型 Step 文本；
- 流式 Response Chunk；
- Conversation 最终持久化文本。

流式清理器是有状态的。协议标记跨网络分片时，会持续抑制整个工具块，直到结束标记，避免中间 JSON 泄漏。

### `PlanAuthority.js`

集中维护：

- 顶层计划不可变结构；
- 合法状态推进；
- Replan 边界；
- 已完成步骤不可回退；
- 子计划完成后的根步骤自动闭合。

`RunPlanStore` 和 `GoalRuntime` 使用同一套 Authority 规则，不再各自实现一份。

### `ToolErrorClassifier.js`

集中维护工具错误的：

- recoverable / fatal 分类；
- 语义 Attempt Key；
- Active Failure；
- Resolved Failure；
- 最新有效错误。

同一脚本、文件或控制操作的后续成功能够解决此前失败，历史错误仍保留供诊断展开。

## 数据迁移

Conversation Store：

```text
21 → 22
```

新增：

```text
conversation.executionThread
assistantMessage.executionThreadId
```

旧会话自动补齐 `executionThread: null`，不会影响原消息、Goal、Plan、Diff、Token Ledger 或 Platform 数据。

## 关键行为

### 普通任务连续执行

```text
第一次运行
→ 建立 Execution Thread / Task
→ 保存 Checkpoint

用户：请你继续
→ 复用同一 Thread / Task / Root Plan
→ 新建 Run Budget
```

### 已解决工具失败

```text
npm test #1 → failed
代码修复
npm test #2 → passed

当前验证状态 → passed
历史失败 → resolved
最终 Run → completed
```

### Plan 自动闭合

```text
根步骤：in_progress
内部步骤：全部 completed / skipped / superseded
→ Runtime 自动将根步骤设为 completed
```

### 公开文本安全

```text
模型自然语言
+ DSML / Tool Call Envelope
→ 用户只看到自然语言
```

## 测试覆盖

专项测试覆盖：

- 普通任务 Thread 创建、续跑、结束和重启恢复；
- “请你继续”识别；
- 明确新任务不复用旧 Thread；
- 失败后成功覆盖旧工具错误；
- 未解决错误仍阻止完成；
- Run Stop Reason 与 Outcome 一致；
- DSML 整段与跨分片清洗；
- 根 Plan 自动闭合；
- Conversation Store 22 迁移；
- Response 流先清洗再显示。

本阶段不包含 Platform 主链切换、动态 Tool Capability 裁剪或 UI 大规模拆分；这些属于后续 Phase。
