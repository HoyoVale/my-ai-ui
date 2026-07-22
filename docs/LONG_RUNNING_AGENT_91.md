# Long-running Agent 1.0

> 实施基线：`my-ai-ui(90)`
>
> 对应项目阶段：91

## 1. 本阶段目标

Long-running Agent 负责把一次即时 Agent Run 升级为可排队、可等待、可唤醒、可恢复的长期作业。

它不替代 Goal Runtime 或 Multi-Agent Supervisor：

```text
Goal
  长期目标、完成标准和总体进度

Platform Job
  一次可调度、可暂停、可恢复的后台作业

Supervisor Task
  可分配给 Worker 的有界任务

Agent Run
  一段实际模型执行

Checkpoint / Receipt
  安全恢复位置与已发生副作用的幂等凭据
```

## 2. 长期 Job 状态机

Job Schema 升级到 v2，持久化状态包括：

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

状态变化统一写入 Platform Journal。Snapshot 只是加速加载；Journal 仍是权威来源。

新增的长期字段包括：

- `wake`：唤醒策略、时间、条件和唤醒次数；
- `retryPolicy`：固定或指数退避、延迟上限、错误白名单/黑名单；
- `requirements`：网络等运行条件；
- `idempotencyKey`：防止同一逻辑 Job 被重复入队；
- `checkpoint`：最近安全恢复位置；
- `receipts`：已经发生的外部副作用凭据；
- `approvalRequestId`：待批准高影响动作；
- `inputRequest`：恢复执行所需的用户输入；
- `externalSignal`：外部条件的持久化信号；
- `waitingReason`：当前不执行模型循环的原因。

## 3. Persistent Job Queue

`PlatformKernel` 继续作为本地持久化内核，不另建一套相互竞争的队列数据库。

入队支持：

- 优先级；
- 执行预算；
- 最大尝试次数；
- 指定时间启动；
- 运行条件；
- 重试策略；
- 幂等键。

相同 Platform Run 下重复提交同一 `idempotencyKey` 时，返回原 Job，不创建第二个作业。

## 4. Scheduler 与单实例运行租约

每个执行 Segment 开始前必须取得：

```text
long-running-job:<jobId>
```

的独占 Lease。

Lease 在执行期间持续续租；丢失 Lease 后本次 Segment 不得被标记为成功。执行结束、等待、失败或取消后释放 Lease。

这保证多个 Scheduler 实例或应用恢复竞争同一 Job 时，只有一个实例能够实际执行。

## 5. Wake Policy

支持以下唤醒方式：

- `immediate`：立即进入队列；
- `at`：到指定时间后进入队列；
- `network_online`：网络恢复后进入队列；
- `app_resume`：系统从休眠恢复后进入队列；
- `approval`：批准完成后进入队列；
- `input`：用户补充输入后进入队列；
- `external`：收到外部信号后进入队列。

等待状态会退出当前模型循环，而不是让模型持续轮询。

## 6. Retry 与 Backoff

失败重试支持：

- `fixed` 固定延迟；
- `exponential` 指数退避；
- 最大延迟；
- 确定性抖动；
- 可重试错误代码白名单；
- 不可重试错误代码黑名单；
- Replanner 分类结果；
- 最大尝试次数。

以下情况默认不自动重试：

- 预算耗尽；
- 用户取消；
- 用户拒绝批准；
- 达到尝试上限；
- Replanner 判断必须补充用户输入；
- Replanner 明确判定不可重试。

旧 Verification Loop 测试中需要验证“立即失败并进入 Replanner”的 Job，会显式关闭自动重试，避免把两个机制混为一谈。

## 7. Checkpoint、Receipt 与副作用幂等

Handler 获得以下长期运行接口：

```text
checkpoint(...)
recordReceipt(...)
hasReceipt(key)
waitForInput(...)
waitForExternal(...)
requestApproval(...)
scheduleAt(...)
```

Checkpoint 用于恢复执行位置；Receipt 用于判断外部副作用是否已经发生。

推荐顺序：

```text
检查 Receipt
→ 执行外部动作
→ 立即写入 Receipt
→ 写入 Checkpoint
→ 继续后续步骤
```

应用崩溃后，新 Segment 必须先检查 Receipt，禁止重复发送、发布或提交。

## 8. Approval Inbox

高影响动作可在进入模型 Handler 前声明：

```js
payload: {
  approvalRequired: true,
  approval: {
    action: "publish",
    risk: "critical",
    summary: "Publish to the external target."
  }
}
```

此时：

1. Job 进入 `waiting_approval`；
2. 不增加模型执行尝试；
3. 不调用 Handler；
4. Approval 持久化到 Inbox；
5. 批准后恢复为 `queued`；
6. 拒绝后进入 `failed`。

批准只能从合法 Job 状态创建，避免留下无法关联的孤儿 Approval。

建议必须批准的操作：

- 对外发送、发布和提交；
- 删除或不可逆修改；
- 权限扩大；
- 使用新账号、域名或敏感凭据；
- 高影响 Git 操作；
- 无法可靠判断是否已经发生的外部副作用。

## 9. 系统与网络生命周期

Electron 生命周期适配层负责：

- 读取当前联网状态；
- 监听系统休眠；
- 监听系统恢复；
- 监听电池/交流电变化；
- 定期检测网络状态变化。

网络中断时，声明需要网络的 Job 进入 `waiting_external/network_online`，并中止当前 Segment；网络恢复后重新进入队列。

系统休眠时，运行中的 Job 保存为 `retry_scheduled/app_resume`；系统恢复后安全唤醒。

生命周期事件只决定“何时运行”，不会绕过 Job Lease、Checkpoint、Receipt 或 Approval。

## 10. Notification Center

通知采用两层结构：

```text
持久化 In-app Notification
        +
尽力投递的 Electron Native Notification
```

即使系统原生通知不支持或投递失败，应用内通知仍保留。

通知覆盖：

- 已入队；
- 等待网络；
- 等待批准；
- 等待输入；
- 已安排重试；
- 已完成；
- 已失败；
- 已取消；
- 批准结果。

Conversation Platform Dock 新增：

- Approval Inbox；
- 通知中心；
- Job 下一次唤醒；
- 等待原因；
- 最近 Checkpoint；
- 网络、休眠和电源状态；
- 输入后继续；
- 暂停、继续、取消和手动重试。

## 11. Retention 与 Journal 一致性

默认保留：

- 完成 Job：30 天；
- 已读或已清除通知：90 天。

清理动作本身写入 `LONG_RUNNING_STATE_PRUNED` Journal 事件，而不是只修改 Snapshot。因此 Snapshot 损坏、回退到 Journal Replay 时，被清理的历史对象不会复活。

被清理 Job 对应的已解决 Approval 会一并删除；Pending Approval 不会被静默清理。

## 12. 崩溃恢复

应用重启时：

- `running` Job 进入安全续跑队列；
- 达到尝试上限的中断 Job 进入 `failed`；
- `scheduled`、`waiting_*`、`retry_scheduled` 状态原样保留；
- Pending Approval 保留；
- Checkpoint 与 Receipt 保留；
- 到期 Job 自动提升为 `queued`；
- 孤儿运行 Lease 由现有 Platform Recovery 处理。

真实子进程 E2E 覆盖：

```text
进程 A
  写入外部副作用 Receipt
  写入 Checkpoint
  创建 Pending Approval
  在 Job 运行中异常退出

进程 B
  从 Journal 恢复
  不重复外部副作用
  从 Checkpoint 继续并完成
  保留并处理原 Pending Approval
```

## 13. 测试入口

新增：

```text
tests/platform/longRunningAgent.test.js
tests/e2e/long-running-agent-crash-recovery.mjs
tests/fixtures/long-running-agent-crash-worker.mjs
tests/regression/longRunningAgent91.test.js
```

命令：

```bash
npm run test:e2e:long-running-crash
```

并已加入：

```bash
npm run check:full
```

以及 GitHub CI。

## 14. 本阶段边界

Long-running Agent 1.0 是本地 Electron 应用内的长期运行基础，不等同于操作系统级常驻服务。

当前边界：

- 应用关闭时不会继续消耗模型；
- 应用再次启动后自动恢复；
- 不包含云端 Worker；
- 不包含 webhook 事件服务器；
- 不包含操作系统登录启动策略；
- 不包含周期性 Cron 产品 UI；
- 不包含 Playwright Computer Use。

下一阶段应先进行 Agent 基础三层的整体验收和 Soak，再接入 Playwright Electron 视觉能力。
