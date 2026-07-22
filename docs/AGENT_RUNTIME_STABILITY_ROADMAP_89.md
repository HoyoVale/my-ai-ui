# Agent Runtime 稳定化路线图

> 当前实施基线：`my-ai-ui(89)`

> 目标：先稳定 Goal Runtime，再稳定 Multi-Agent Supervisor，最后建立可恢复的 Long-running Agent；完成三层后再接入 Playwright Electron 视觉能力和 Chat/Coding 能力分层。

## 1. 总体判断

Goal Runtime、Multi-Agent Supervisor、Long-running Agent 是无人值守 Agent 的三层核心基础：

```text
Goal Runtime
  负责“目标是什么、当前处于什么阶段、是否真的完成、崩溃后从哪里恢复”
        ↓
Multi-Agent Supervisor
  负责“任务如何拆分、由谁执行、资源如何隔离、结果如何验收和合并”
        ↓
Long-running Agent
  负责“何时启动、如何长期运行、何时暂停/唤醒、如何跨重启继续”
```

这三层稳定后，项目的 Agent 主骨架基本稳定。后续 Playwright、MCP、Skill、GitHub、文件系统等都应作为 Capability/Tool 接入，而不是反过来控制 Agent 生命周期。

仍需长期保持稳定的横向基础包括：

- Tool 安全边界与幂等收据；
- Conversation、Checkpoint 和运行日志持久化；
- 用户批准与权限升级；
- 资源预算、超时、熔断和可观测性；
- 跨版本数据迁移。

## 2. 开发顺序

### Phase 1：Goal Runtime 1.0

目标：让 Goal 成为独立、可恢复、可审计的长生命周期对象，而不是会话上的简单文本字段。

#### 2.1 数据模型

Goal 保留用户层状态：

- `status`: `active | paused | completed`

新增运行阶段：

- `idle`
- `planning`
- `executing`
- `evaluating`
- `replanning`
- `waiting`
- `completed`

新增持久化字段：

- `runtimeRevision`：每次运行态变更递增；
- `runtime`：当前/上次 Run、Task、尝试次数、续跑次数、心跳和可恢复性；
- `waiting`：等待类型、原因、用户所需动作和开始时间；
- `checkpoint`：最近检查点的安全指针与摘要；
- `progress`：完成标准通过数和比例；
- `lastTransition`：最后一次状态迁移；
- `eventHistory`：有界生命周期审计记录。

#### 2.2 生命周期规则

- 运行开始：`idle/waiting → planning`；
- Segment 开始：`planning/replanning → executing`；
- Segment 完成：`executing → evaluating`；
- 证据不足继续：`evaluating → replanning → executing`；
- 达到安全边界：进入 `waiting` 并保存检查点；
- 应用异常退出：下次加载时把运行中 Goal 恢复为 `waiting/recovery`；
- 只有 Goal Verifier 与 Completion Authority 都通过，才能进入 `completed`；
- UI、模型或普通 IPC 不得直接把 Goal 标成完成。

#### 2.3 验收标准

- 旧版 Goal 数据自动迁移，不丢 objective、criteria、verification；
- 非法阶段跳转会被拒绝；
- 旧 Run 的心跳不能覆盖新 Run；
- 每个 Segment 都能更新 Goal 心跳与阶段；
- 检查点只保存安全摘要/引用，不复制完整工具原始输出；
- 进程在执行中退出后，重新加载可识别为可恢复状态；
- Goal 完成仍受验证证据与签名许可双重约束；
- 事件历史有上限，避免会话文件无限增长。

#### 2.4 本阶段实现状态

本补丁已完成：

- `electron/goal/GoalRuntime.js` 独立 Goal Runtime；
- Goal Schema v3 → v4 迁移；
- ConversationManager 生命周期接口；
- AgentRuntime 启动、执行、评估、重规划、检查点和结束同步；
- Goal 面板显示运行阶段与等待原因；
- Goal Runtime 单元测试；
- Conversation 持久化集成测试；
- 独立子进程崩溃/重启恢复 E2E；
- CI 增加 Goal Runtime crash recovery 步骤。

### Phase 2：Multi-Agent Supervisor 1.0

目标：由一个确定性的 Supervisor 管理 Worker，而不是让多个 Agent 自由并发和互相聊天。

#### 2.5 核心对象

```text
SupervisorRun
TaskGraph
AgentRegistry
WorkerLease
WorkerCheckpoint
Handoff
Evaluation
IntegrationDecision
```

每个 Task 至少包含：

- `id / goalId / parentTaskId`
- `objective / acceptanceCriteria`
- `dependencies`
- `requiredCapabilities`
- `workspaceScope / resourceLocks`
- `assignedAgentId / attempt`
- `status / checkpoint / receipts`
- `evaluation / integrationStatus`

#### 2.6 调度规则

- Supervisor 只根据 Task Graph、依赖、资源锁和预算调度；
- Worker 不能自行扩大任务范围；
- 默认并发 2，设置硬上限；
- 同一文件、分支、浏览器会话或外部账号必须有资源租约；
- Worker 输出必须是结构化 Handoff，不能只返回自然语言“完成了”；
- Evaluator 独立检查完成标准；
- Integrator 只消费通过验收的 Worker Checkpoint；
- 冲突、重复失败和无进展必须回到 Supervisor 重新规划。

#### 2.7 失败策略

- 可重试错误：指数退避，并限制同 Task 尝试次数；
- 确定性错误：直接阻塞，不盲目重试；
- Worker 崩溃：释放租约，从最后 Checkpoint 恢复；
- 合并冲突：创建 Integration Task，不让原 Worker直接强推；
- 验收失败：附缺失证据，回到原 Worker 或新 Debug Worker；
- Supervisor 崩溃：从 Task Graph 和租约日志重建状态。

#### 2.8 验收标准

- 同一 Task 不会被两个 Worker 重复提交；
- 资源租约在崩溃后可回收；
- Worker 无法越过 capability/workspace 边界；
- 结果未经 Evaluator 不能进入集成；
- 集成失败不会删除 Worker 分支与 Checkpoint；
- Supervisor 重启后 Task Graph 状态一致；
- 事件日志可回答“谁、何时、为什么执行了什么”。

#### 2.8.1 本阶段实现状态

本补丁已完成：

- Task Graph Schema v2 与批次原子 DAG 校验；
- Task、资源与 Workspace Scope 租约，包含续租心跳和冲突回滚；
- Worker Structured Handoff v2、内容指纹、Goal/Task Graph 修订绑定；
- 独立 Evaluator AgentRun，生产环境使用模型验收，测试环境提供确定性验收器；
- 未验收、验收失败或 Handoff 不完整的任务不能进入 Integration；
- Worker 失败时保留有变更的 Worktree/Checkpoint；
- `running`、`review` 与 Evaluator 中断场景的重启恢复；
- 任务图、租约、Handoff、独立验收与崩溃恢复测试；
- CI 增加 Multi-Agent Supervisor crash recovery 步骤。

仍留给 Phase 3 处理：持久化 Scheduler、跨时间唤醒、退避队列、Approval Inbox 与长期保留策略。

### Phase 3：Long-running Agent 1.0

目标：将一次对话 Run 升级为可排队、可暂停、可唤醒、跨应用重启继续的长期作业。

#### 2.9 核心组件

- Persistent Job Queue；
- Scheduler / Wake Policy；
- Background Worker 或独立 Agent Service；
- Run Lease 与单实例锁；
- Checkpoint Resume；
- Network/Power/App lifecycle 监听；
- Notification Center；
- Approval Inbox；
- Retention / Cleanup Policy。

#### 2.10 Job 状态

```text
queued
scheduled
running
waiting_input
waiting_approval
waiting_external
retry_scheduled
paused
completed
failed
cancelled
```

Goal 与 Job 分离：

- 一个 Goal 可以产生多个 Job；
- Job 是一次可调度执行；
- Goal 记录长期目标和总进度；
- Supervisor Task 记录可分配工作；
- Agent Run 记录一次模型执行；
- Checkpoint 连接这些对象，但不混为一体。

#### 2.11 无人值守安全门

以下操作必须暂停等待批准：

- 外部发送、发布、支付、删除；
- 权限扩大；
- 新域名、新账号或敏感凭据使用；
- 高影响 Git 操作；
- 无法回滚的文件/系统修改；
- 工具结果无法确认或出现 reconciliation 状态。

#### 2.12 验收标准

- 应用重启、系统休眠、网络中断后不会重复副作用；
- 同一 Job 只有一个有效 Lease；
- 重试有上限和退避；
- 等待外部事件时不占用模型循环；
- 用户能看到当前 Job、下一次唤醒和阻塞原因；
- 取消后不会被 Scheduler 再次唤醒；
- 日志和 Checkpoint 有清理策略。

#### 2.12.1 本阶段实现状态

本补丁已完成：

- Job Schema v2 与完整长期状态机；
- Persistent Job Queue、指定时间唤醒和独占 Run Lease；
- 固定/指数退避、最大延迟、错误白名单/黑名单与尝试上限；
- Checkpoint、幂等 Side-effect Receipt 与跨重启恢复；
- Approval Inbox、输入等待和外部信号等待；
- Electron 休眠/恢复、网络变化与电源状态适配；
- 持久化通知中心与尽力投递的原生通知；
- Journal 一致的完成 Job、已解决 Approval 与通知清理策略；
- Conversation Platform Dock 的长期任务、Inbox 和通知 UI；
- 真实双进程崩溃恢复 E2E 与 CI 步骤。

至此，Goal Runtime、Multi-Agent Supervisor 与 Long-running Agent 三层基础均已完成 1.0。下一步应进行整体验收、Soak 和 Electron 视觉测试，再接入 Playwright Electron Capability。

## 3. Playwright Electron 的接入时机

在 Phase 1–3 稳定后再加入视觉能力：

```text
Supervisor
  → Browser/Computer Task
    → Playwright Electron Capability
      → screenshot / inspect / click / type / assert
```

Playwright 必须服从：

- Goal/Task 生命周期；
- Browser Session 租约；
- 页面域名白名单；
- 操作前后截图；
- 关键动作批准；
- 可重放但不重复副作用的 Action Receipt；
- UI 变化后的视觉/语义双重定位回退。

## 4. Chat / Coding 模式的后续分层

模式不只是 UI 标签，而是 Capability Profile：

### Chat

- 无默认工作区写权限；
- 以对话、搜索、记忆、个人工具为主；
- 更严格的外部副作用批准；
- 默认不启用多 Worker 编码任务。

### Coding

- 必须绑定 Workspace；
- 文件、终端、Git、测试、Worktree、代码 Evaluator；
- Multi-Agent 以 Task Graph 和资源锁运行；
- 允许较长运行预算，但不能放宽固定安全边界。

## 5. 测试分层

### 每次提交

- Goal/Task/Run 状态机单元测试；
- Schema migration；
- Store 持久化；
- 非法跳转、旧 Run、重复事件和历史上限；
- lint、全部 Node tests、Vite build。

### CI 崩溃恢复矩阵

- Goal 执行中进程退出；
- Checkpoint 写入前后退出；
- Supervisor 分配后 Worker 退出；
- Worker Checkpoint 后 Integrator 退出；
- Tool 副作用状态未知；
- Windows/Linux 路径与锁行为。

### Electron / Playwright

- preload smoke；
- Goal UI 设置、暂停、恢复；
- 真实 Electron crash recovery；
- Conversation/Response 状态一致；
- 后续加入视觉定位和截图断言。

### 周期性 Soak

- 连续多 Segment；
- 多 Goal 轮换；
- Worker 租约反复创建/回收；
- 会话文件增长和迁移；
- 内存、句柄和子进程泄漏；
- 事件历史上限与清理。

## 6. 下一阶段建议

Goal Runtime 与 Multi-Agent Supervisor 的核心稳定化已经完成。下一步只做 Long-running Agent 1.0，不继续增加 Playwright、MCP 或新工具。优先顺序：

1. Persistent Job Queue 与 Wake Policy；
2. Job/Run 单实例 Lease；
3. Retry Backoff 与失败分类；
4. Waiting Input / Approval / External 状态；
5. 系统休眠、网络中断与应用重启恢复；
6. Notification Center 与 Approval Inbox；
7. Retention、Cleanup 与长时间 Soak。
