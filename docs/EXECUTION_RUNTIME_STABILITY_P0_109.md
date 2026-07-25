# Execution Runtime Stability P0 — Truth Consistency

基线：`my-ai-ui(107)`  
阶段：Stability P0  
目标：让任务边界、Goal、工具证据、Run 结果、活动时间线和公开回复保持一致。

## 1. 问题背景

真实回归样本中出现了以下矛盾：

- 用户明确要求“新建一个项目”，系统却续接旧 Thread；
- 黑洞 Goal 被重新规划成水流体项目；
- `npm run build` 退出码为 1，最终回复却宣称构建成功；
- Run 已经失败，但 Activity 中仍有 `running` 项；
- Assistant Message 的 `status: complete` 被误解为任务完成。

P0 不增加新功能，而是在现有 Execution Model 2.0 上建立一条不可绕过的事实链：

```text
User Input
→ Task Boundary
→ Thread / Goal
→ Tool Evidence
→ Run Outcome
→ Public Response
→ UI Projection
```

## 2. TaskBoundaryClassifier

新增：

```text
electron/execution-model/TaskBoundaryClassifier.js
```

输出：

```js
{
  boundary: "same_task" | "new_task" | "uncertain",
  confidence,
  reasons,
  currentIdentifiers,
  messageIdentifiers
}
```

以下表达被视为强任务边界：

- 新建/创建一个项目、任务、工程、应用或仓库；
- 从零开始另做一个项目；
- 切换到另一个任务；
- 不再继续之前的任务；
- 对应英文表达。

强任务边界优先于 `active-thread-default`。即使旧 Thread 仍可继续，也不得把明确的新项目写入旧 Thread。

接入位置：

- `ThreadCommand`
- `ExecutionThreadRouter`
- Legacy checkpoint/thread continuation

## 3. ObjectiveCompatibilityGate

新增：

```text
electron/execution-model/ObjectiveCompatibilityGate.js
```

Goal Replan 现在只能改变实现路径，不能替换核心目标。

允许：

```text
优化黑洞渲染
→ 调整 Shader
→ 修改后处理
→ 修复构建
```

拒绝：

```text
优化黑洞渲染
→ 新建水流体项目
```

发生目标漂移时返回：

```js
{
  ok: false,
  code: "goal-objective-drift",
  requiresNewThread: true,
  compatibility
}
```

原 Goal 和 Root Plan 不会被新任务污染。

## 4. CompletionEvidenceGate

新增：

```text
electron/agent/finalization/CompletionEvidenceGate.js
```

最终回复中的以下成功声明必须存在结构化证据：

| 声明 | 必须存在的证据 |
|---|---|
| 依赖安装成功 | 最新相关安装命令成功 |
| 构建成功 | 最新相关构建命令 `exitCode === 0` |
| 测试通过 | 最新相关测试命令 `exitCode === 0` |
| 任务完成 | 无活动失败/未闭合工具，Plan 完成，Goal 验证有效 |

如果模型输出与证据冲突，公开回复会被协调为确定性的事实摘要，例如：

```text
本次工作已保存，但任务尚未全部完成。

当前问题
- 命令：npm run build
- Could not resolve vite

尚未完成
- 验证项目构建
```

后续成功的同类命令会 supersede 旧失败，因此“先失败、后成功”仍可正常完成。

## 5. Finalization 最终权威门

`RunEngine` 会先计算 Outcome，但 P0 还在 `finalizeRun()` 最终出口增加二次验证。

即使内部调用直接传入：

```text
outcome: completed
```

只要存在：

- 未解决工具失败；
- 未闭合工具；
- 未完成 Plan；
- 未通过 Goal Verification；

就会降级为 `continuable` 或 `failed`，不能绕过证据门。

## 6. ActivityTerminalizer

新增：

```text
electron/agent/finalization/ActivityTerminalizer.js
```

Run 进入终态时，所有仍处于以下状态的 Event、Tool、Batch：

```text
queued
running
in_progress
retrying
cancelling
```

会统一转换：

| Run Outcome | 活动终态 |
|---|---|
| completed | completed |
| failed | failed |
| cancelled | cancelled |
| continuable / interrupted / waiting | interrupted |

新增不变量：

```text
终态 Run 中不存在 running Item。
```

## 7. Message 与 Run 状态分离

Assistant Message 现在分别保存：

```text
status          消息传输状态
runOutcome      执行结果
runPhase        Run 阶段
runResumable    是否可继续
```

例如：

```json
{
  "status": "complete",
  "runOutcome": "failed",
  "runPhase": "failed",
  "runResumable": false
}
```

含义是：回复已经写完，但任务执行失败。

`RunProjection` 优先读取 `runOutcome`，不再根据 `message.status === "complete"` 推断任务成功。

Conversation Store 仍保持 v23，不需要数据版本迁移。旧消息会从 Activity 中推导新字段。

## 8. 最终总结的发布方式

工具活动、命令和进度仍然实时流式显示。

最终总结改为：

```text
模型生成
→ PublicTextSanitizer
→ CompletionEvidenceGate
→ 一次发布可信最终总结
```

不再把未经证据验证的最终总结逐块直接展示。这样可以避免用户先看到“构建成功”，随后 Runtime 才发现实际失败。

## 9. 永久回归 Fixture

新增：

```text
tests/fixtures/truth-consistency-black-hole-water.json
```

覆盖真实故障链：

```text
黑洞任务
→ 用户明确新建水项目
→ 构建失败
→ 模型错误宣称安装/构建/项目完成
```

专项测试验证：

1. 新项目必须创建新 Thread；
2. 新项目不能 Replan 旧 Goal；
3. 失败构建不能产生 completed Outcome；
4. 无 Receipt 的成功声明会被移除；
5. 后续成功构建可解除旧失败；
6. 终态活动不得保留 running；
7. Message delivery 与 Run Outcome 分离；
8. Finalization 不能绕过 Evidence Gate。

## 10. 验证

新增命令：

```powershell
npm run test:stability-p0-truth
```

已验证：

```text
P0 + Execution Consistency + RunEngine + Goal + Phase G + Response contract
65 passed
0 failed
```

另外执行并通过：

- Phase 2 AgentRuntime；
- Phase 3 Core Runtime；
- Phase 4 Conversation UI；
- Execution Model Phase A–G；
- Phase F Codex UI；
- Conversation/Goal/Execution Thread 持久化；
- Response Activity Flow。

当前容器没有完整 `node_modules`。完整 `npm test` 会在依赖 `ai`、`zod` 等测试加载时失败，因此未宣称完整 lint、build、Electron E2E 在此环境通过。

## 11. P0 验收结果

```text
新项目绝不进入旧 Thread                 已实现
失败工具绝不能生成成功结论               已实现
终态 Run 不存在 running Item             已实现
Replan 不能替换 Goal                     已实现
Message complete 不等于 Run completed    已实现
```
