# my-ai-ui Execution Model 2.0 架构适配计划

> 状态：已批准，Phase A 已实施
> 基线版本：my-ai-ui(101)
> 计划目标：在保留现有 Goal、Platform、Tool Runtime 与 Conversation 体系的前提下，建立统一、可审计、可迁移的 Thread / Run / Item 执行模型。

## 1. 背景与问题定义

my-ai-ui 已经形成了一套比普通聊天应用复杂得多的执行架构：

- Conversation 与 Chat/Coding 会话；
- Execution Thread；
- Goal Runtime；
- Run、Segment、Step；
- Root Plan 与内部子计划；
- Tool Runtime、Tool Result、Approval、Diff、Token Ledger；
- Platform Run、Task Graph、Worker、Reviewer、Integration；
- Long-running Job、Journal 与崩溃恢复；
- Activity Timeline 与 Conversation UI。

这些模块解决了真实问题，但概念边界仍有部分重叠：

1. Conversation、Execution Thread、Goal 与 Platform Run 的任务身份关系不够统一；
2. Run、Segment、模型 Step 与用户的一轮输入之间缺少正式契约；
3. Message、Activity、Tool、Diff、Plan 在 UI 中需要跨来源拼接；
4. “继续”“补充要求”“重新生成”“分支”等输入仍可能由不同入口分别判断；
5. Provider 的上下文延续、应用状态与崩溃恢复尚未形成统一抽象；
6. 直接照搬其他 Agent 产品的 Thread/Turn/Item 模型会破坏现有 Goal 和多 Agent 架构。

因此本计划不进行概念替换，而是建立一层适配模型：

> 保留现有领域对象，以 Execution Thread、Run 和 Execution Item 作为统一身份、生命周期与投影协议。

---

## 2. 核心决策

### 2.1 不进行一比一重命名

禁止简单实施：

```text
Conversation → Thread
Run → Turn
Activity → Item
```

原因：

- Conversation 是 UI 与消息容器，不一定等于一个持续任务；
- Goal 可能跨越多个 Run；
- Platform Run 包含多个 Worker 与 Reviewer；
- Activity 是展示投影，不是全部执行事实；
- Tool、Diff、Plan 和 Journal 已有各自权威 Store。

### 2.2 建立适配层而不是第二套业务数据库

Execution Model 2.0 负责：

- 统一身份；
- 状态机契约；
- Run 血缘；
- Item 顺序索引；
- 输入路由决策；
- 跨模块架构不变量。

它不负责复制：

- 完整 Tool Result；
- 完整 Diff；
- 完整 Plan；
- Goal 生命周期；
- Platform Task Graph；
- Journal 原始事件。

---

## 3. 现有概念与目标定位

| 现有概念 | Execution Model 2.0 定位 | 决策 |
|---|---|---|
| Conversation | 用户界面、消息与上下文容器 | 保留 |
| Execution Thread | 持续任务的权威身份 | 强化为 Thread |
| Run | 一次已接受用户输入触发的完整执行 | 对应一轮执行 |
| Segment | Run 内的预算与模型循环边界 | 保留为内部概念 |
| Step | 模型步骤或计划执行步骤 | 保留为内部概念 |
| Activity Event | 用户可见过程投影 | 作为 Item 来源之一 |
| Tool Record | 工具生命周期权威记录 | 保留 |
| Message | 用户与 Assistant 内容权威记录 | 保留 |
| Goal | 跨 Run 的显式长期目标 | 位于 Thread 之上 |
| Plan | Thread 或 Goal 的权威计划 | 独立保留 |
| Platform Run | 多 Agent 编排实例 | 平行保留 |
| Task Graph | Platform 任务依赖图 | 独立保留 |
| Agent Run | Worker、Reviewer 或 Replanner 执行 | 后续桥接为子 Thread |
| Long-running Job | 后台持久任务 | 独立保留 |
| Journal | 崩溃恢复与审计事实 | 底层权威，不直接等于 Item |

---

## 4. 目标层级

### 4.1 普通 Chat/Coding 执行

```text
Workspace / Project
└─ Conversation
   ├─ Messages
   ├─ activeExecutionThreadId
   └─ Execution Threads
      └─ Execution Thread
         ├─ Goal reference（可为空）
         ├─ Root Plan
         ├─ Working State
         ├─ Checkpoint
         ├─ Runs
         │  └─ Run
         │     ├─ User Input
         │     ├─ Execution Items
         │     ├─ Segments
         │     ├─ Tool Records
         │     ├─ Diff
         │     ├─ Token Ledger
         │     └─ Outcome
         └─ Thread Lineage
```

第一阶段产品仍可限制为：

```text
一个 Conversation 同时只有一个活跃普通 Thread
```

但数据模型应允许保留多个历史 Thread。

### 4.2 Platform 与多 Agent

```text
Platform Run
├─ Goal
├─ Task Graph
├─ Supervisor Thread
├─ Worker Threads
├─ Reviewer Threads
├─ Integration Thread
├─ Evidence
└─ Completion Permit
```

Platform Task 状态仍由 PlatformTaskService 管理，Thread 不能取代 Task Graph 或 Completion Authority。

---

## 5. 五个必须严格区分的概念

### 5.1 Conversation 不等于 Thread

Conversation 管理：

- 消息浏览；
- Chat/Coding 模式；
- Workspace 与模型绑定；
- Context 控制；
- 用户导航；
- UI 展示。

Thread 管理：

- 当前任务身份；
- 任务连续性；
- Root Plan；
- Working State；
- Checkpoint；
- Run 血缘；
- 任务完成或等待状态。

### 5.2 Run 才是一轮已接受输入的执行

示例：

```text
用户：修复测试
→ Run 1

用户：还是失败，这是日志
→ Run 2

用户：请继续
→ Run 3
```

三个 Run 属于同一个 Thread。

Run 内可以有多个 Segment：

```text
Run
├─ Segment 1：分析与读取
├─ Segment 2：代码修改
├─ Segment 3：验证
└─ Finalization
```

Segment 不得被当作新的用户轮次。

### 5.3 Execution Item 是统一索引，不是新 Store

Execution Item 的建议字段：

```text
id
threadId
runId
scope
sequence
kind
status
visibility
sourceType
sourceId
parentItemId
summary
resultRef
createdAt
completedAt
```

支持类型：

```text
user_message
assistant_commentary
assistant_final
plan_update
tool_call
command
file_change
diff
approval
checkpoint
verification
error
status
```

Item 只保存有界摘要和来源引用。

禁止将以下内容复制进 Item：

- 大型 Tool Result；
- 原始工具参数；
- 完整命令输出；
- 完整 Diff；
- Provider 原始协议；
- 敏感数据。

### 5.4 Goal 不等于 Thread

Goal 是用户显式创建的长期目标，可跨多个 Run，未来也可以跨 Platform Task。

普通任务允许：

```text
Thread.goalId = ""
```

不得为普通任务生成假的 Goal ID。

### 5.5 Platform Run 不等于普通 Thread

Platform Run 是编排和授权边界。

Worker Thread 只能：

- 执行已授权 Task；
- 产生 Artifact、Tool Receipt 与 Handoff；
- 提交结果供 Evaluator 审核。

Worker Thread 不能直接：

- 完成 Platform Task；
- 完成 Goal；
- 签发 Completion Permit；
- 修改其他 Worker 的状态。

---

## 6. 权威状态划分

| 状态 | 唯一权威模块 |
|---|---|
| Thread 连续性 | ExecutionThreadService |
| Run 生命周期 | RunStateMachine |
| Run 结果 | RunOutcomeResolver |
| Plan | PlanAuthority |
| Tool 生命周期 | Tool Runtime |
| Tool 错误分类 | ToolErrorClassifier |
| Diff | RunDiffTracker |
| Token | TokenLedger |
| Goal | GoalRuntime |
| Platform Task | PlatformTaskService |
| Platform 完成 | CompletionAuthority |
| 公开文本 | PublicTextSanitizer |
| Item 时间线 | ExecutionItemProjector |
| 输入路由 | ExecutionThreadRouter |

禁止跨模块直接修改内部对象，例如：

```js
conversation.executionThread.status = "completed";
```

必须通过权威服务执行：

```js
executionThreadService.completeThread(...);
```

---

## 7. 状态机契约

### 7.1 Thread 状态

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

主要合法转换：

```text
created → active
active → running
running → waiting
running → continuable
running → completed
running → failed
running → cancelled
waiting → running
continuable → running
completed → active
failed → active
active → archived
completed → archived
failed → archived
cancelled → archived
```

规则：

- archived 不可重新打开；
- completed → active 表示修订同一任务；
- 每次状态修改必须带 Revision；
- Revision 冲突必须拒绝；
- 状态转换必须留下审计记录。

### 7.2 Run 状态

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

规则：

- 一个 Run 只能属于一个 Thread；
- 终态 Run 不得重新打开；
- 继续、重试、重新生成必须创建新的 Run；
- Run 血缘必须显式保存；
- Run Sequence 在同一 Thread 内单调增加。

### 7.3 Execution Item 状态

```text
queued
running
completed
failed
cancelled
superseded
```

失败后验证成功示例：

```text
command:test:1 → failed
command:test:2 → completed
verification:test → completed
```

第一次失败仍保留，但可以标记：

```text
status: superseded
resolved: true
supersededBy: command:test:2
```

---

## 8. Run 血缘模型

Run 关系：

```text
initial
follow_up
resume
retry
regenerate
fork
```

建议字段：

```text
previousRunId
retryOfRunId
regeneratedFromRunId
forkedFromThreadId
forkedFromRunId
```

约束：

1. retryOfRunId 与 regeneratedFromRunId 不得同时存在；
2. 同 Thread 父 Run 的 sequence 必须小于当前 Run；
3. retry 必须提供 retryOfRunId；
4. regenerate 必须提供 regeneratedFromRunId；
5. fork 必须提供源 Thread 和源 Run；
6. Run 不得引用自己。

---

## 9. 用户输入路由

输入必须统一为五种显式操作。

### 9.1 Start

含义：开始新的任务 Thread。

```text
thread/start
```

创建：

- 新 Thread；
- 新 Task ID；
- 新 Root Plan；
- 新 Working State；
- 首个 Run。

### 9.2 Resume

含义：Run 已结束但任务仍需继续。

```text
thread/resume
run/start
```

复用：

- Thread；
- Workspace Snapshot；
- Plan；
- Working State；
- Skill Snapshot。

创建新的 Run。

### 9.3 Steer

含义：Agent 仍在运行时补充约束。

```text
turn/steer
```

进入：

```text
activeRun.steeringInputs
```

只在安全边界注入：

- Tool Batch 结束；
- Segment 边界；
- 下一模型 Step 开始前。

不得创建平行 Run。

### 9.4 Fork

含义：从当前或历史 Run 创建独立任务方向。

```text
thread/fork
```

规则：

- 新旧 Thread ID 必须不同；
- 只复制快照；
- 不共享可变 Plan；
- 不共享 Working State 对象；
- 保存 forkedFromThreadId 与 forkedFromRunId。

### 9.5 Regenerate

含义：重新生成某次 Assistant 回复。

规则：

- 复用原 Thread；
- 创建新 Run；
- 保存 regeneratedFromRunId；
- 原 Run、Tool、Diff、Token 与 Checkpoint 不删除；
- UI 只切换当前显示版本。

---

## 10. Routing Decision 审计契约

每次路由都必须产生结构化决策：

```text
id
command
action
state
source
conversationId
workspaceId
messageId
currentThreadId
targetThreadId
activeRunId
sourceThreadId
sourceRunId
targetRunId
reason
evidence
shadow
createdAt
```

路由来源：

```text
explicit_command
active_thread
active_run
semantic_fallback
system_recovery
legacy_shadow
```

规则：

- 不保存原始用户消息全文；
- evidence 使用有界代码列表；
- reject 必须有原因；
- steer 必须有 activeRunId；
- fork 的目标 Thread 必须不同；
- regenerate 的新旧 Run 必须不同；
- Shadow 模式必须记录 legacyAction 与 mismatch。

---

## 11. Provider 上下文与应用状态分离

Provider Continuation 只是优化，不是权威状态。

```text
Execution Thread
├─ 应用权威状态
├─ Plan
├─ Working State
├─ Tool Evidence
├─ Checkpoint
└─ Provider Continuation
   ├─ provider
   ├─ responseId
   └─ compatibility metadata
```

规则：

- Provider 不支持时退回应用管理的 Context；
- 切换模型或 Provider 时可丢弃 continuation；
- responseId 失效不得导致 Thread 丢失；
- 崩溃恢复必须依赖 Checkpoint、Journal 和 Tool Receipt；
- Provider ID 不得作为应用中唯一的任务身份。

---

## 12. 长任务状态策略

模型 Context 可以压缩，但下列状态必须外部化：

- Thread Objective；
- Root Plan；
- 当前活动步骤；
- 已完成步骤；
- 未解决错误；
- 最近成功验证；
- 文件 Hash 与 Diff Baseline；
- Workspace Snapshot；
- Skill Snapshot；
- Provider Continuation；
- 未解决 Tool Side Effects；
- Checkpoint 与 Token Ledger。

---

## 13. 分阶段实施计划

### Phase A：Architecture Contract

目标：只建立纯契约和测试，不改变运行逻辑。

新增：

```text
ExecutionModelContract
ThreadStateMachine
RunIdentityContract
ExecutionItemSchema
ThreadRoutingDecision
```

完成标准：

- 明确 ID 所有权；
- 明确 Thread、Run、Item 状态机；
- 明确 Run 血缘；
- 明确 Start、Resume、Steer、Fork、Regenerate；
- 明确权威状态；
- 新模块不被现有 Runtime 导入；
- 不修改 Conversation Store Schema。

风险：低。

### Phase B：Run 与 Item 投影

新增：

```text
ExecutionItemProjector
ExecutionItemSequence
RunProjection
```

原则：

- 从已有 Message、Activity、Tool、Diff、Plan 投影；
- 不让 Runtime 同时写两套业务数据；
- Item 不复制大型结果；
- 重载后顺序稳定。

风险：中低。

### Phase C：Thread Routing

新增：

```text
ExecutionThreadRouter
ThreadCommand
ThreadRoutingDecisionStore
SteeringQueue
```

完成标准：

- Input、Conversation IPC 与 AgentRuntime 统一经过 Router；
- Resume 不创建新 Thread；
- Start 不污染旧 Thread；
- 活跃 Run 补充输入进入 Steering Queue；
- Workspace 切换不能静默复用旧 Thread。

风险：中。

### Phase D：持久化与崩溃恢复

下一个 Conversation Store 版本加入：

```text
activeExecutionThreadId
executionThreads
threadLineage
runLineage
providerContinuation
routingDecisions
```

完成标准：

- 旧单 executionThread 自动迁移；
- 崩溃后恢复同一 Thread；
- Running Run 恢复为 continuable；
- 不重复不确定写操作；
- Provider Continuation 失效不影响恢复。

风险：中高。

### Phase E：Platform Bridge

目标：将 Worker、Reviewer、Integration 映射为子 Thread。

完成标准：

- 一个 Agent Run 对应一个子 Thread；
- Task Graph 仍是 Platform 权威；
- Completion Authority 保持唯一；
- Worker 失败不直接改变 Goal 终态；
- Integration 可追溯全部 Evidence。

风险：高。

### Phase F：UI 与交互

普通模式显示：

- 当前任务；
- 当前状态；
- 是否可以继续；
- 是否正在运行。

操作：

```text
继续当前任务
开始新任务
从这里分支
结束当前任务
```

开发者模式额外显示：

- Thread ID；
- Run ID；
- Item Sequence；
- Provider Continuation；
- Run Lineage；
- Routing Decision。

风险：中。

### Phase G：Shadow Rollout

新旧路由同时计算，只有旧逻辑执行：

```text
legacyDecision
newDecision
decisionMismatch
```

达到稳定门槛后再切换：

```text
executionModelV2 = true
```

风险：低，但不可省略。

---

## 14. 架构不变量

1. 一个 Run 只能属于一个 Thread；
2. 一个 Item 必须属于一个 Run，或明确标记为 Thread 级；
3. 终态 Run 不允许重开；
4. 继续、重试、重新生成必须创建新 Run；
5. 一个 Thread 只能绑定一个 Workspace Snapshot；
6. 普通任务不得伪造 Goal ID；
7. Plan 只能由 PlanAuthority 修改；
8. Goal 只能由 GoalRuntime 修改；
9. Platform Task 只能由 PlatformTaskService 修改；
10. UI 不得根据零散字段推断完成状态；
11. Tool Result 不得完整复制进 Item；
12. Provider Response ID 不能作为恢复的唯一依据；
13. 路由不得只依赖文本关键词；
14. 所有路由必须留下可审计 Decision；
15. Thread、Run、Plan 更新必须支持 Revision 冲突检测；
16. Shadow 路由不得改变生产执行行为。

---

## 15. 测试矩阵

### 普通任务

```text
发送请求
→ 创建 Thread
→ 创建 Run
→ 执行完成
→ Thread completed
```

### 失败后修复

```text
测试失败
→ 修改
→ 测试成功
→ 旧失败 superseded/resolved
→ Run completed
```

### 继续执行

```text
Run continuable
→ 用户继续
→ 同 Thread
→ 新 Run
→ 同 Plan
```

### 普通反馈

```text
用户：还是不对
→ 复用当前 Thread
→ 创建 follow-up Run
```

### Active Steering

```text
Agent 正在运行
→ 用户补充限制
→ 不创建平行 Run
→ 安全边界注入
```

### 新任务

```text
明确 Start
→ 新 Thread
→ 旧 Thread 不改变
```

### Fork

```text
从历史 Run 分支
→ 新 Thread
→ 独立 Plan 和 Working State
```

### Regenerate

```text
重新生成
→ 同 Thread
→ 新 Run
→ 原 Run 保留
```

### 崩溃恢复

```text
Tool 写入后崩溃
→ 恢复原 Thread
→ 不盲目重复写入
→ Reconciliation
```

### Platform

```text
Supervisor
→ Worker Threads
→ Reviewer Thread
→ Integration
→ Completion Permit
```

---

## 16. 发布与回滚策略

### 发布门槛

每一阶段必须满足：

- 专项测试通过；
- 前序 Phase 回归通过；
- 无新 lint warning；
- 数据迁移具有回滚路径；
- 不删除旧字段直到 Shadow 阶段结束；
- 所有写操作仍受 Tool Receipt 与 Reconciliation 保护。

### 回滚原则

- Phase A/B 只新增纯模块，可直接移除；
- Phase C 在 Feature Flag 后启用；
- Phase D 保留旧 Schema 迁移兼容至少一个版本；
- Phase E 按 Platform Run 独立开关；
- Phase F UI 可退回旧 Projection；
- Phase G 完成前不得删除 Legacy Router。

---

## 17. 当前实施状态

Phase A 已在 my-ai-ui(101) 基线上实现：

```text
electron/execution-model/
├─ ExecutionModelContract.js
├─ ThreadStateMachine.js
├─ RunIdentityContract.js
├─ ExecutionItemSchema.js
├─ ThreadRoutingDecision.js
└─ index.js
```

当前特性：

- 纯函数与不可变常量；
- 不导入 AgentRuntime、ConversationManager 或 PlatformKernel；
- 现有 Runtime 尚未导入 Execution Model 2.0；
- Conversation Store Schema 未改变；
- 用户行为未改变；
- 新增 Phase A 独立测试命令。

下一步进入 Phase B 前，应先使用真实历史对话样本验证 Item Projection 的排序与去重规则。

---

## Phase B 实施状态（103）

Phase B 已完成只读 Run 与 Execution Item 投影：

```text
ExecutionItemProjector
ExecutionItemSequence
RunProjection
```

当前特性：

- 从已有 Message、Activity、Tool、Plan、Checkpoint、Verification 与 Diff 投影；
- 不新增第二套 Runtime 写入；
- Item 使用稳定 ID、连续 Sequence 与确定性 Fingerprint；
- Activity Tool 和旧 Tool Calls 自动去重；
- Tool Result 与完整 Diff 仅保存引用；
- Conversation Store 仍为版本 22；
- 生产 Runtime 与 UI 尚未导入投影层；
- 真实压力测试对话已验证 2 个 Run、各 47 个 Item，重载顺序稳定；
- Provider DSML 嵌套关闭格式已补强清洗。

下一步进入 Phase C 前，应先保持投影旁路运行，并为新旧 Thread Routing Decision 建立 Shadow Comparison。

---

## Implementation status update — Phase C (104)

Phase C has been implemented in Shadow Mode.

Implemented:

- `ThreadCommand`;
- `ExecutionThreadRouter`;
- `ThreadRoutingDecisionStore`;
- `SteeringQueue`;
- Shadow calculation for ordinary messages and regeneration;
- bounded mismatch diagnostics in developer Run details;
- optional `threadCommand` transport through Agent IPC.

Production authority remains unchanged:

- legacy Checkpoint/Execution Thread continuation still executes;
- busy input is still rejected;
- Steering Queue is not injected;
- routing decisions are not persisted;
- Conversation Store remains version 22.

The next implementation step is Phase D: durable Thread/Run lineage, routing decision persistence, provider continuation metadata, migration, and crash recovery.
