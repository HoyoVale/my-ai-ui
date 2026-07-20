# Tool Runtime 终极重构：第四阶段实现报告

## 1. 阶段目标

第四阶段用于完成“增量 IPC 与 UI 收口”，把前三阶段已经建立的 Tool Runtime 权威状态，按不同窗口的真实需要投影给 Renderer，避免长任务中反复传输完整状态，同时把恢复操作和开发者诊断收敛到明确的 UI 入口。

本阶段落实以下目标：

1. Text Chunk、Status Patch、Snapshot 分通道；
2. Response 仅消费紧凑投影；
3. Conversation 消费会话投影；
4. 开发者详情改为按需读取；
5. Recovery Center 形成独立历史入口；
6. Provider/Tool 熔断器参数可配置，并支持手动重置。

---

## 2. 增量 Agent IPC 协议

### 2.1 新增通道

新增以下 Agent IPC：

```text
agent-get-snapshot
agent-snapshot-changed
agent-status-patch
agent-text-chunk
agent-get-run-details
agent-get-runtime-recovery-history
agent-get-circuit-breakers
agent-reset-circuit-breaker
```

旧的 `agent-get-status` 与 `agent-status-changed` 暂时保留，用于兼容旧 Renderer，但不再按每个 Token 广播完整快照。旧通道只在 Run 生命周期发生变化时发送。

### 2.2 三类数据

#### Snapshot

完整但经过窗口投影的当前状态，用于：

- 窗口首次连接；
- Run 切换；
- Renderer 丢失增量基线后重新同步；
- 恢复或窗口重建。

#### Text Chunk

只传输 `liveStepText` 与 `finalText` 的变化：

```text
append  → 新文本是旧文本的后缀，只发送新增部分
replace → 文本被重写或清空，发送替换值
```

#### Status Patch

传输非文本字段变化，并对以下集合使用增量 upsert/remove：

- `activeToolCalls`
- `activity.events`

Plan、生命周期、恢复摘要等普通结构字段仅在真正变化时发送。

### 2.3 Revision 与竞态处理

每次主进程发布状态都会增加 `revision`。Renderer 维护最后接受的 revision：

- 旧 Snapshot 不能覆盖较新的 Patch；
- 同 revision 的 Text Chunk 和 Status Patch 可以顺序应用；
- Response 在缺少基线时不会盲目应用 Patch，而是重新请求紧凑 Snapshot；
- Response Start 即使晚于初始 Snapshot，也会重新建立正确基线，避免回复空白。

这解决了异步 `ipcRenderer.invoke()` 与广播事件交错时的典型竞态。

---

## 3. 窗口级数据投影

Tool Runtime 的权威状态仍位于主进程。Renderer 不再共享一份“大而全”的状态，而是按窗口职责获得不同投影。

| 窗口/用途 | 接收内容 | 不接收内容 |
|---|---|---|
| Input | Run 生命周期、错误、是否可停止 | Plan、工具历史、原始诊断 |
| Response | 最终/流式文本、紧凑 Plan、最近 30 条公开活动、待恢复摘要 | 原始 Tool Input/Output、完整工具记录、Checkpoint、内部诊断 |
| Conversation | 文本、Plan、最近 240 条公开活动、最多 80 条公开工具记录、待恢复摘要 | Secret、幂等键、Lease owner、Receipt checksum、原始 Journal payload |
| Developer details | 用户点击后读取完整运行详情 | 默认不预加载 |

### 3.1 Response Compact Projection

Response 只获得渲染浮窗所需数据：

- 文本流；
- Plan；
- 最近活动；
- 必要的恢复提醒。

它不再为每个 Token 克隆完整 Tool Record、完整 Activity 历史和 Runtime Diagnostics。

### 3.2 Conversation Projection

Conversation 获得更大的公开投影，用于：

- 当前活动面板；
- 工具流；
- Plan Dock；
- 任务面板；
- Recovery Center 提醒。

公开 Tool Record 会保留工具名称、公开目标、状态、公开结果摘要和耗时，但会移除敏感原始数据。

### 3.3 普通用户与开发者边界

普通用户仍然可以看到：

- 工具名称；
- 工具公开目标；
- 工具执行状态；
- Plan 与进度说明；
- 公开结果摘要；
- 需要核验或确认的恢复状态。

开发者模式按需显示：

- 原始 Tool Input/Result；
- Runtime Diagnostics；
- Provider/Tool 熔断器详情；
- 内部 Run、Task、Call 信息；
- 已持久化的诊断快照。

开发者模式只增加诊断可见性，不改变 Tool 权限和执行策略。

---

## 4. 开发者详情按需读取

Conversation 的任务面板不再自动携带完整开发者诊断。

启用开发者模式后，面板先显示“运行诊断尚未载入”，用户点击“载入运行诊断”后，才调用：

```text
agent-get-run-details
```

主进程会：

- 活跃 Run：返回当前完整开发者投影；
- 历史 Run：从 Conversation 记录和 Tool Runtime 持久化数据中重建详情；
- 非开发者模式：拒绝请求。

这样普通运行路径不会因为开发者信息而放大 IPC 和 Renderer 内存占用。

---

## 5. 独立 Recovery Center

Conversation 顶栏新增独立的恢复中心入口，并显示待处理数量。

Recovery Center 会展示：

- 当前活跃任务的恢复问题；
- 历史会话中未解决的工具调用；
- 最近已处理记录；
- 对应会话和更新时间；
- 开发者模式下的 callId。

支持动作：

```text
重新核验
确认已生效
确认未生效
放弃操作
```

每个任务只保留最新恢复记录。修复了同一 taskId 在多个 Assistant 消息中存在快照时，旧记录覆盖新记录或被重复展示的问题；恢复操作也只更新该任务最新的消息记录。

恢复中心与当前任务活动面板分离：即使用户切换会话，也能找到历史未决副作用。

---

## 6. 熔断器设置与手动重置

### 6.1 可配置参数

Provider 与 Tool 熔断器分别支持：

- 失败阈值；
- 统计窗口；
- 冷却时间；
- Half-open 试探请求数。

设置经过主进程校验和范围限制，并在 Settings Runtime 应用设置时同步到实际熔断器实例。

### 6.2 诊断与重置

开发者模式下可查看：

- 当前状态：closed/open/half-open；
- 失败次数；
- 剩余冷却时间；
- 参数摘要；
- Provider/Tool 各个实例。

支持：

- 重置单个实例；
- 重置 Provider 组；
- 重置 Tool 组；
- 全部重置。

主进程会校验 reset scope，普通模式无法调用诊断和重置 IPC。

---

## 7. 兼容与安全策略

### 7.1 兼容旧 Renderer

- 保留旧状态读取和监听 IPC；
- 旧监听器只接收生命周期变化，避免恢复完整 Token 快照风暴；
- 新 Hook 检测不到增量 API 时自动退回旧协议。

### 7.2 数据净化

公开投影不会发送：

- API Key、Token、Cookie 等 Secret；
- 原始 Tool 输出；
- Idempotency Key；
- Lease owner；
- Receipt checksum；
- Journal 原始 payload；
- 完整 Checkpoint。

### 7.3 主进程权限边界

- Recovery 和 Run Details 只允许 Conversation 窗口调用；
- 熔断器诊断和重置只允许 Setting 窗口调用；
- 开发者详情和熔断器操作还会二次检查开发者模式。

---

## 8. 测试更新

新增或更新测试覆盖：

- Text Chunk 与 Status Patch 分离；
- 文本 append/replace；
- 延迟 Snapshot revision 保护；
- Response Compact Projection；
- Conversation Public Projection；
- 恢复投影字段边界；
- 同 taskId 恢复历史去重与最新记录更新；
- Recovery Center 独立入口；
- 开发者详情显式载入；
- 熔断器参数校验、配置和手动重置；
- Electron E2E 中 Recovery Center 和熔断器 UI 选择器。

本地验证结果：

```text
Lint: 0 errors, 0 warnings
Node Tests: 371 passed, 0 failed
Vite Build: success
Tool Runtime Crash Recovery E2E: passed
```

完整 Electron UI E2E 在当前执行环境无法完成，因为 Electron 二进制下载发生 `fetch failed`。这不是项目测试断言失败，仍需由 GitHub Actions 验证真实 Electron UI 生命周期。

---

## 9. 本阶段修改范围

本阶段共修改或新增 28 个源代码与测试文件，集中于：

```text
electron/agent
electron/conversation
electron/ipc
electron/preload
electron/runtime
electron/settings
electron/shared
src/Conversation
src/Response
src/Setting
src/shared
tests/agent
tests/conversation
tests/e2e
tests/regression
tests/runtime
tests/settings
```

---

## 10. 第五阶段入口

第四阶段完成后，Runtime 状态协议与 UI 边界已经收口。第五阶段应集中进行真实写操作与终极验收：

1. 原子文件写工具试点；
2. 文件 hash Receipt、verify 与 idempotency；
3. 写入各崩溃窗口的故障注入；
4. Shell/Git 工具统一接入 SubprocessSupervisor；
5. Journal 滚动、Manifest 和磁盘配额；
6. Renderer 崩溃后重订阅 Snapshot；
7. 真实 Electron 进程崩溃/重启恢复 E2E；
8. 长时间 soak、IPC 压力和性能基准。
