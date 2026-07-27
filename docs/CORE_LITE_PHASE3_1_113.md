# Core Lite 3.1 — Agent Runtime Production Chain Convergence

本阶段基于 `my-ai-ui(112)` 继续收缩生产 Agent Runtime，只改变一轮消息的生产调用链。

本阶段不修改 Conversation UI，不升级会话 Schema，也不物理删除 Goal、Plan、Execution Thread、Execution Model 或 Platform 源码，确保可以随时回滚。

## 一、阶段目标

Core Lite 2 已经让高级编排系统从生产路径不可达，但实际执行链仍然残留一层旧结构：

```text
AgentRuntime
→ AgentRunExecution
→ RunEngine
→ segmentCallbacks
→ CoreLiteRunLoop
→ executeAgentSegment
```

Core Lite 3.1 将其收敛为：

```text
AgentRuntime
→ AgentRunSession
→ CoreLiteRunLoop.runToCompletion()
→ executeModelLoop
→ Tool Runtime / MCP / Skill / Memory
→ finalization / outcome
```

`AgentRunSession` 现在是单轮执行的唯一运行状态来源；执行层不再重复传递和维护 `runId`、`conversationId`、`AbortController` 等平行状态。

## 二、AgentRunSession 直接进入生产执行层

准备阶段原先向执行层传递：

```js
{
  runId,
  conversationId,
  abortController,
  context,
  settings
}
```

现在传递：

```js
{
  session: runtime.activeRun,
  context,
  settings
}
```

执行层通过 `resolveRunInvocation()` 从 `AgentRunSession` 读取：

- `runId`；
- `conversationId`；
- `AbortController`；
- Objective；
- 当前运行状态；
- Tool、Skill、Activity、Diff 与 Token Ledger 状态。

旧参数形式仍可作为兼容输入，但生产入口不再使用。

## 三、CoreLiteRunLoop 接管完整单轮生命周期

`CoreLiteRunLoop` 现在直接接收 `session`：

```js
new CoreLiteRunLoop({
  session,
  runDeadline,
  isActive
})
```

新增：

```js
runToCompletion()
```

它在一个轻量类中完成：

1. 取消与总超时边界检查；
2. 单轮模型与工具循环；
3. Core Lite Checkpoint 创建；
4. 必要的 finalization；
5. 空最终文本 fallback；
6. outcome 与 stop reason 归一化；
7. 最终回复证据一致性处理。

生产路径不再创建 `RunEngine`，也不再传入 `segmentCallbacks`。

## 四、执行语义从 Segment 收敛为 Run

生产执行函数新增：

```js
executeModelLoop()
```

生产路径现在使用：

```text
executeRun
onRunStart
onRunComplete
runUnit
```

旧接口：

```js
executeAgentSegment()
```

仍作为兼容别名保留，并自动将旧 `segment` 转换为 `runUnit`。底层 Tool Runtime 的 `segmentId` 字段暂时保留，避免本阶段扩大到 Journal、Receipt 和历史恢复 Schema。

## 五、兼容与回滚边界

本阶段仍保留：

- `RunEngine.js`；
- `ExecutionThread.js`；
- `GoalCompletionVerifier.js`；
- `LongTaskOrchestrator.js`；
- `SegmentExecutionLoop.js`；
- 历史测试与高级分支源码。

这些模块不再由生产 Agent 路径导入或实例化。Core Lite 3.2 及后续阶段再处理 Conversation Schema 和物理删除。

## 六、未改动内容

- Conversation UI；
- Tool Call UI；
- Goal / Plan 历史展示兼容；
- Conversation Store Schema；
- Tool Runtime Journal / Receipt Schema；
- MCP、Custom Tools、Skill、Memory；
- Approval、Diff、Checkpoint、Cancel、Retry 与 Resume。

## 七、测试

新增：

```powershell
npm run test:core-lite3.1
```

专项测试覆盖：

- LiteRunLoop 从 AgentRunSession 获取运行身份与取消信号；
- LiteRunLoop 在不经过 RunEngine 的情况下完成 finalization、fallback 和 outcome；
- 生产准备层只传递 Session；
- 生产执行层不再导入或实例化 RunEngine；
- 新执行语义使用 `executeModelLoop`；
- 旧高级模块仍存在，但生产路径不可达。

## 八、验证结果

无外部依赖的 Core Lite 与架构联合回归：

```text
tests 49
pass 49
fail 0
```

全量 Node 测试扫描：

```text
tests 725
pass 686
fail 39
Assertion failures 0
```

39 项失败全部发生在测试加载阶段，当前环境缺少：

```text
ai
zod
react
@modelcontextprotocol/sdk
ajv
adm-zip
```

当前压缩包不包含 `node_modules`，依赖安装命令在执行环境中被中断，因此 Oxlint 与 Vite Build 无法运行：

```text
oxlint: not found
vite: not found
```

完整依赖环境应执行：

```powershell
npm ci
npm run test:core-lite3.1
npm run lint
npm run build
npm run check:full
```

## 九、下一阶段

Core Lite 3.2 建议处理 Conversation Schema 简化：

- 新运行不再写高级 Conversation 字段；
- Message Metadata 成为 Plan 等纯展示信息的容器；
- 为历史 Goal、Plan、Execution Thread 字段建立一次性迁移和只读兼容；
- 在不破坏旧会话的前提下缩小 Store 写入面。
