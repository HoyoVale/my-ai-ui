# Tool Runtime 终极重构：第二阶段实现报告

## 1. 阶段目标

第二阶段在第一阶段的持久化状态机、Journal、Receipt、Lease 与 Checkpoint 基础上，补齐四类运行时治理能力：

1. Recovery Center 的人工恢复动作；
2. Provider 与 Tool 熔断器；
3. 可强制终止进程树的子进程监督器；
4. 可在 CI 中运行的真实崩溃注入恢复测试。

本阶段的核心原则仍然是：**Runtime 的权威状态独立于 UI；不确定副作用不得盲目重放；开发者模式只增加诊断可见性，不改变权限和执行语义。**

---

## 2. Recovery Center

### 2.1 人工恢复动作

对于处于 `needs_reconciliation` 或 `needs_confirmation` 的 Tool Call，Conversation 的活动面板现在提供以下动作：

- **重新核验**：再次调用工具声明的 `reconcile` 逻辑；
- **确认已生效**：用户确认外部副作用已发生，Runtime 写入人工确认 Receipt，并将调用推进到 `reported`；
- **确认未生效**：将调用安全退回 `prepared`，允许后续重新执行；
- **放弃操作**：写入取消 Receipt，并结束该调用，不再自动执行。

每次动作都写入 Runtime Journal，并更新 Conversation 中持久化的恢复快照。应用重启后，已处理的调用不会重新出现为未知状态。

### 2.2 恢复规则

- `confirm_applied` 不执行原工具，只生成具有审计信息的权威 Receipt；
- `confirm_not_applied` 只允许从人工确认状态回到 `prepared`；
- `abandon` 生成取消结果，避免任务永久卡在运行中；
- `recheck` 只对声明了 reconciliation 能力的工具有效；
- 存在活动 Run 时禁止修改历史 Run 的恢复状态，避免并发写入冲突。

### 2.3 UI 信息边界

普通用户可见：

- 工具名称；
- “需要核验”或“需要确认”的状态；
- 简洁的风险说明；
- 四个人工处理动作；
- 操作成功或失败的用户友好结果。

开发者模式额外可见：

- `callId`；
- Provider/Tool Circuit Breaker 的状态与计数；
- 失败摘要、冷却时间和半开探测状态；
- 运行中子进程诊断快照。

普通用户不会看到：

- 幂等键；
- Lease owner；
- Receipt checksum；
- 原始 Tool Input/Output；
- Journal 内部 payload；
- 堆栈和内部路径。

---

## 3. Provider 与 Tool 熔断器

### 3.1 状态机

熔断器使用三个状态：

```text
closed → open → half_open → closed/open
```

- `closed`：正常放行请求；
- `open`：在冷却期内快速失败，不继续压垮故障服务；
- `half_open`：冷却结束后仅允许有限探测请求；
- 探测成功后关闭熔断器，探测失败则重新打开。

### 3.2 默认策略

当前默认参数：

- 失败阈值：3 次；
- 统计窗口：60 秒；
- 冷却时间：30 秒；
- Half-open 最大并发探测：1 次。

Provider 和 Tool 使用独立 Registry，避免某个模型服务故障影响本地工具，或某个工具故障阻塞其他工具。

### 3.3 计入熔断的失败

Provider 主要计入：

- 网络不可达；
- 超时；
- 429；
- 5xx；
- Provider 临时不可用。

下列错误默认不计入 Provider 熔断：

- 用户取消；
- 400、401、403、404、422 等配置或请求错误。

Tool 主要计入：

- Timeout；
- 临时不可用；
- Rate limit；
- Runtime/Internal failure；
- 持久化异常。

下列错误默认不计入 Tool 熔断：

- Schema 无效；
- Policy 拒绝；
- 用户取消；
- 并发冲突；
- 明确的业务失败。

### 3.4 用户体验

普通模式只显示“模型服务暂时不可用”或“工具暂时不可用，请稍后重试”，不暴露内部统计。

开发者模式显示：

- 熔断对象；
- 当前状态；
- 窗口内失败次数；
- 打开和恢复时间；
- 最近错误摘要；
- 剩余冷却时间。

---

## 4. 子进程监督器

新增 `SubprocessSupervisor`，作为未来 Shell、Git、构建、测试、浏览器驱动等工具的统一进程执行层。

### 4.1 主要能力

- 统一接收 `AbortSignal`；
- 独立 Timeout；
- 标准输出和错误输出有界缓存；
- 支持实时 stdout/stderr 回调；
- 先温和终止，再在宽限期后强制终止；
- Session 关闭时集中终止全部遗留进程；
- 开发者诊断可查看仍在运行的 PID、命令、开始时间和终止原因。

### 4.2 跨平台终止策略

Windows：

```text
taskkill /PID <pid> /T
→ 宽限期后 taskkill /PID <pid> /T /F
```

Linux/macOS：

```text
SIGTERM 发送到独立进程组
→ 宽限期后 SIGKILL 发送到进程组
```

这样不仅终止父进程，也尽可能清理其子孙进程，避免测试、编译器或脚本在 Agent 已取消后继续运行。

### 4.3 Tool 接入方式

Tool Session 的执行上下文新增：

```js
context.subprocessSupervisor
```

后续所有需要启动外部进程的工具应通过该对象执行，不应直接调用 `child_process.spawn` 或 `exec`。这条规则应作为新的 Tool 开发约束写入代码审查清单。

---

## 5. 真实崩溃注入 E2E

新增独立测试：

```text
npm run test:e2e:runtime-crash
```

测试流程：

1. 启动独立 Node Worker；
2. Worker 写入 `TOOL_DISPATCHED`；
3. 模拟远程副作用已经生效；
4. 在 Receipt 落盘前以退出码 91 强制崩溃；
5. 新 Runtime 打开同一 Journal；
6. 验证调用恢复为 `needs_reconciliation`；
7. 模拟用户选择“确认已生效”；
8. 写入人工确认 Receipt；
9. 再次重启 Runtime；
10. 验证相同 `callId` 直接重放 Receipt，而不是重新执行原 Tool。

该测试验证了最危险的崩溃窗口：**外部副作用已经发生，但本地成功结果尚未持久化。**

GitHub Actions 的 Electron E2E Job 已先运行此测试，再运行 UI E2E。该测试不依赖 Electron 二进制，因此能稳定覆盖 Runtime 的崩溃恢复语义。

---

## 6. 现有代码落点

### Runtime 层

- `electron/runtime/CircuitBreaker.js`
- `electron/runtime/runtimeCircuitBreakers.js`
- `electron/tools/process/SubprocessSupervisor.js`

### Tool 执行层

- `electron/tools/core/ToolExecutor.js`
- `electron/tools/createAgentToolSession.js`
- `electron/tools/runtime-state/ToolExecutionLedger.js`
- `electron/tools/runtime-state/ToolCallStateMachine.js`

### Agent 与持久化层

- `electron/agent/AgentRuntime.js`
- `electron/agent/runCheckpoint.js`
- `electron/conversation/ConversationManager.js`

### IPC 与 UI

- `electron/shared/ipcChannels.cjs`
- `electron/preload/preload.cjs`
- `electron/ipc/handlers/agentIpc.js`
- `src/Conversation/components/TaskPanel.jsx`
- `src/Conversation/Conversation.jsx`
- `src/Conversation/utils/taskActivity.js`

### 测试与 CI

- `tests/runtime/circuitBreaker.test.js`
- `tests/tools/subprocessSupervisor.test.js`
- `tests/tools/toolRuntimeDurability.test.js`
- `tests/e2e/tool-runtime-crash-recovery.mjs`
- `tests/fixtures/runtime-crash-worker.mjs`
- `.github/workflows/ci.yml`

---

## 7. 验证结果

```text
Lint: 0 errors, 0 warnings
Node tests: 352 passed, 0 failed
Vite build: passed
Runtime crash-recovery E2E: passed
```

当前执行环境下载 Electron 二进制时仍出现 `fetch failed`，因此无法在本地启动完整 Electron UI E2E；这一限制不影响 Node Runtime 测试、真实子进程崩溃注入测试和构建结果。Windows/Linux GitHub Actions 应继续作为最终 UI E2E 验证环境。

---

## 8. 第二阶段完成后的行为准则

1. 不确定的远程写操作绝不自动重试；
2. 用户人工决策必须形成持久化 Receipt；
3. Provider/Tool 的临时故障不应触发无限重试；
4. 所有外部进程必须受 Supervisor 管理；
5. Abort 表示请求停止，不代表副作用一定未发生；
6. 普通 UI 展示可理解的任务状态，开发者 UI 展示诊断数据；
7. UI 不能成为 Runtime 状态的权威来源；
8. 每个新增写工具必须声明 retry/reconcile 语义并补充崩溃测试。

---

## 9. 后续阶段建议

第二阶段已经完成原计划中的四项核心工作。后续可进入第三阶段，重点不再是继续堆叠状态，而是工程化收口：

- 将熔断参数纳入开发者设置并支持手动重置；
- 为具体 Shell/Git/Test 工具迁移到 `SubprocessSupervisor`；
- 增加 Recovery Center 独立历史列表、筛选和批量处理；
- 加入 Provider/Tool 运行指标与长期压力测试；
- 对 Journal、Receipt 和 Checkpoint 做 Schema migration 与版本兼容测试；
- 增加真实 Electron 崩溃后窗口重启和 UI 恢复 E2E。
