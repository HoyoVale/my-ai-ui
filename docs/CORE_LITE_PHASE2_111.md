# Core Lite 2 — Lightweight Agent Run Session

本阶段基于 `my-ai-ui(109)` 继续收缩生产 Agent Runtime。

Core Lite 1 已经切断 Goal、Plan、Platform、多 Agent、Long-running 与 Worktree 的生产入口；Core Lite 2 进一步清理这些高级系统残留在单次消息运行链中的状态和编排依赖。

## 一、阶段目标

将生产消息运行路径收敛为：

```text
用户消息
→ 准备会话、模型、Skill、Memory 与 Workspace
→ 创建 AgentRunSession
→ 创建 Tool Session
→ 单次 CoreLiteRunLoop
→ Tool Runtime / MCP / Custom Tools
→ 最终回复或可续跑检查点
→ 持久化工具回执与运行结果
```

生产路径不再创建或维护：

- Goal Runtime 状态；
- Root Plan、Plan State 与 Replan 状态；
- Execution Thread 与 Thread Routing；
- Platform Run；
- LongTaskOrchestrator；
- SegmentExecutionLoop；
- GoalCompletionVerifier；
- Working State 与 Goal Verification。

高级源码仍保留在仓库中，等待 Core Lite 3 物理删除；本阶段只保证生产消息路径不可达。

## 二、AgentRunSession

新增：

```text
electron/agent/AgentRunSession.js
```

`AgentRunSession` 只保存一轮回复真正需要的状态：

- `runId`、`taskId`、`conversationId`；
- 用户任务 `objective`；
- 续跑关系 `parentRunId`、`resumedFromMessageId`；
- Workspace、模式与模型绑定；
- Skill Runtime；
- Abort Controller；
- Tool Session、审批、安全状态；
- Activity、Diff、Token Ledger；
- 当前步骤文本、最终文本与状态机。

它不再包含：

```text
goalId
persistentGoalId
goalSpec
executionThreadId
platformRunId
orchestrator
initialPlan
initialPlanState
workingState
```

开发者状态页可以读取 `runSession.snapshot()`，但普通状态投影不会暴露内部会话对象。

## 三、轻量执行循环

新增：

```text
electron/agent/execution/CoreLiteRunLoop.js
```

每轮消息只执行一个运行段：

```text
run:<runId>
```

模型仍可在该运行段中进行多步工具调用，`maxSteps`、总超时、单工具超时、重复调用保护和审批逻辑保持不变。

轻量循环明确区分：

- 正常完成；
- 用户取消；
- Agent Run 总超时；
- 工具或模型边界导致的可续跑检查点。

不再为了单次消息创建 Root Plan、Segment Budget 或高级 Orchestrator Snapshot。

## 四、Core Lite 检查点

新增：

```text
electron/agent/CoreLiteCheckpoint.js
electron/agent/CoreLiteCheckpointResume.js
```

检查点只记录：

- 任务、运行与续跑关系；
- Workspace、模型和 Skill 绑定；
- 当前 phase、outcome、stopReason；
- 最近工具结果；
- Tool Runtime Receipt 与未确认副作用；
- Journal Cursor；
- Context Compaction 次数。

不再写入空的兼容字段：

```text
goalId
executionThreadId
plan
planState
orchestration
workingState
```

续跑时只恢复 Core Lite 所需绑定，不再因为历史会话存在 Active Goal 而自动续跑。用户明确说“继续”、点击继续任务，或发送相同语义的续跑消息时，才读取最近的可恢复检查点。

旧版检查点仍可被读取，但其中的 Goal、Plan、Execution Thread 字段不会进入新的 `AgentRunSession`。

## 五、准备、执行、持久化与收尾

### AgentRunPreparation

- 直接检查当前 Runtime 是否忙碌；
- 不再调用 Execution Model Routing；
- 不再创建 Execution Thread；
- 新消息与重新生成都直接创建 `AgentRunSession`；
- 重新生成沿用原消息 `taskId`，但不恢复高级运行状态。

### AgentRunExecution

- 使用 `CoreLiteRunLoop`；
- 保留 Model Runtime、Tool Runtime、MCP、Custom Tools、Skill Capability、审批、Journal、Receipt、Checkpoint 与 Context Compaction；
- 不再创建 LongTaskOrchestrator、SegmentExecutionLoop 或 Goal Verifier。

### AgentRunPersistence

- 通过 `createCoreLiteRunCheckpoint()` 保存运行进度；
- Assistant Message 不再主动写入空 Plan、Plan State 或 Execution Thread ID；
- 重新生成旧消息时，会清除旧 `executionThreadId`，避免高级状态残留在新回复上。

### AgentRunFinalization

- 完成判定只基于 Tool Records、Tool Runtime Recovery、Stop Reason、公开最终文本与 Diff；
- 不再完成 Goal 或 Execution Thread；
- 不再写 Goal Verification 或 Plan Completion。

## 六、兼容边界

本阶段仍不升级 Conversation Store Schema，也不物理删除高级字段解析逻辑。

因此：

- 历史会话仍可显示和迁移；
- 高级分支仍能读取旧数据；
- Core Lite 新运行不会生成新的高级状态；
- Core Lite 3 再统一删除高级模块、Schema 字段、IPC 和死代码。

## 七、测试

新增：

```powershell
npm run test:core-lite2
```

专项测试覆盖：

- `AgentRunSession` 不含高级状态；
- Core Lite Checkpoint 不持久化 Goal、Plan、Thread 与 Orchestration；
- 续跑只恢复 Core Lite 绑定；
- 单段执行只运行一次；
- 取消与超时边界不会混淆；
- 生产 Agent 路径无法导入高级 Orchestrator、Execution Model 或 Thread Routing。

## 八、验证结果

从 `my-ai-ui(109)` 建立独立基线后，仅应用 Core Lite 2 变更完成静态与冷覆盖验证。

专项与架构契约：

```text
Core Lite 1 + Core Lite 2 专项：11/11
Core Lite、历史兼容与生产路径契约：77/77
变更 JS 与测试文件语法检查：24/24
相对导入路径检查：通过
尾随空白检查：0
生产路径高级状态与高级编排引用：0
```

完整 `node --test` 结果：

```text
tests 721
pass 682
fail 39
Assertion failures 0
```

39 项失败全部发生在测试文件加载阶段，原因是当前沙箱没有安装以下外部依赖：

```text
ai
zod
react
@modelcontextprotocol/sdk
ajv
adm-zip
```

尝试恢复依赖时，内部 npm 镜像对 `zwitch-2.0.4.tgz` 持续返回：

```text
HTTP 503
```

因此本环境没有宣称 Oxlint、Vite Production Build、真实 MCP/Skill 集成或 Electron/Playwright GUI 已通过。完整依赖环境应执行：

```powershell
npm ci
npm run test:core-lite2
npm run lint
npm run build
npm run check:full
```

## 九、下一阶段

Core Lite 3 将负责物理清理：

- 删除 Goal、Plan、Execution Model、Platform 与多 Agent 模块；
- 删除高级 IPC、Preload Channel 与设置字段；
- 升级 Conversation Store Schema；
- 迁移并删除历史高级字段；
- 清理高级测试和文档入口。
