# Multi-Agent Supervisor 1.0 实施说明

> 基线：`my-ai-ui(89)`
>
> 阶段目标：稳定 Task Graph、Worker Lease、Structured Handoff、Independent Evaluator 与 Crash Recovery；不在本阶段继续扩展新工具。

## 1. Supervisor 边界

Supervisor 是确定性调度层，不由 Worker 自由组织协作。运行链路为：

```text
Goal Runtime
  → Atomic Task Graph
  → Lease-aware Scheduler
  → Isolated Worker + Worktree
  → Structured Handoff + Checkpoint
  → Independent Task Evaluator
  → Integration eligibility
```

Worker 不能创建子 Agent，也不能用自然语言“完成了”直接结束任务。只有独立 Evaluator 批准后，Task 才能进入 `completed`，并取得 `integrationStatus: eligible`。

## 2. Task Graph Contract v2

每个任务持久化以下边界：

- `objective`、`parentTaskId`、`dependencies`；
- `acceptanceCriteria`；
- `requiredCapabilities`；
- `workspaceScope`；
- `resourceLocks`；
- `priority`、`maxAttempts`；
- `checkpoint`、`receipts`；
- `evaluation`、`evaluationHistory`、`integrationStatus`。

任务批次会先完整校验再一次性写入。缺少依赖、重复 ID、自依赖或循环依赖时，整批拒绝，不留下半张任务图。Task Graph 使用稳定指纹绑定完成权限。

## 3. Worker Lease

Supervisor 在启动 Worker 前获取：

- 当前 Task 的独占租约；
- 任务声明的共享或独占资源租约；
- 可选 Workspace Scope 租约。

租约在 Worker、Checkpoint 和 Evaluator 全过程持续心跳。任一租约丢失会中断执行；部分获取失败会原子回滚已取得租约。应用重启后，孤儿租约会被回收。

## 4. Structured Handoff v2

Worker Handoff 包含：

- Task、AgentRun、Role 与 Attempt；
- Goal Revision 与 Task Graph Revision；
- Baseline/Output Commit；
- Changed 状态与 Tool receipts；
- Evidence 与逐条 Acceptance Claim；
- Unresolved/Error；
- SHA-256 内容指纹。

Evaluator 会拒绝缺少指纹、指纹不匹配、Task/Agent 不匹配或修订过期的 Handoff。

## 5. Independent Evaluator

生产环境为任务创建独立 `kind: evaluator` 的 AgentRun，并从 Worker 输出提交创建只读 Worktree。Evaluator 必须返回结构化 JSON，逐条给出标准是否通过及证据。

硬性拒绝条件包括：

- Worker Handoff 未通过结构校验；
- 任一 Acceptance Criterion 缺少通过结论或证据；
- Handoff 存在 unresolved/error；
- Evaluator 修改只读 Worktree；
- Evaluator 运行失败或被中断。

测试与无模型注入场景使用确定性 Evaluator，但依然创建独立 AgentRun，不允许 Worker 自评。

## 6. Integration Gate

Integration Coordinator 只消费同时满足以下条件的 Worker Artifact：

- Worker AgentRun 已完成；
- Task Evaluation 已批准；
- Evaluation 指向当前 Worker AgentRun；
- Evaluation 绑定当前 Worker Handoff 指纹；
- `integrationStatus === "eligible"`。

失败 Worker 的有变更 Worktree 默认保留，避免调试证据和 Checkpoint 被清除。

## 7. Crash Recovery

重启恢复覆盖：

- 运行中的 Worker → `interrupted/continuable`；
- 运行中的 Evaluator → Task `continuable`；
- Worker 已完成但 Evaluator 尚未启动的 `review` 窗口 → `continuable`；
- 孤儿 Task/Resource/Worktree Lease 回收；
- Worker Handoff、Checkpoint、Artifact 与 Task Graph 保留；
- 从最近 Checkpoint 创建新 Worker Worktree继续执行。

## 8. 测试矩阵

新增或扩展：

- Task Graph 原子写入、前向依赖、循环拒绝；
- Task/Resource Lease 冲突；
- Structured Handoff 指纹与修订绑定；
- Deterministic Evaluator 证据门；
- Model-backed Independent Evaluator 通过与拒绝；
- Integration 未验收隔离；
- Worker 并发、依赖、重试、预算中断；
- 独立子进程在 `review` 边界崩溃后的恢复与继续。

运行命令：

```powershell
npm run test
npm run test:e2e:supervisor-crash
npm run check
npm run test:electron
npm run test:e2e
```

## 9. 下一阶段

下一阶段只进入 Long-running Agent 1.0：Persistent Job Queue、Wake Policy、Run Lease、Retry Backoff、Approval Inbox、系统休眠/网络恢复与通知。Playwright Electron 视觉能力继续等待三层基础完成后再接入。

## 10. 本次环境验证结果

已实际通过：

```text
Supervisor / Platform 定向回归：44 passed, 0 failed
独立子进程 crash recovery：2 个崩溃窗口通过
修改过的 JS/MJS：node --check 通过
PlatformDock JSX：TypeScript JSX parser 通过
Git diff whitespace：通过
```

本次环境未能完成：

- `npm ci`：公共 registry 出现 DNS `EAI_AGAIN`，内部镜像返回 HTTP 503；
- Oxlint、完整 `npm test`、Vite build：依赖未完整安装，因此未执行；
- Electron/Playwright：挂载目录中没有找到 Electron 可执行二进制，无法启动真实窗口。

这些未执行项目已经保留在 `npm run check:full` 和 GitHub CI 中，本机依赖正常后应继续运行。
