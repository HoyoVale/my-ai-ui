# Continuity & Plan Authority 1.0（版本 93）

本阶段修复黑洞 3D 压力测试暴露出的跨轮失忆、顶层计划被重建、可恢复工具错误中断 Goal，以及 Plan 控制工具与普通工具并发冲突问题。

## 1. Goal Working State

Goal Schema 升级为 v5，并持久化一份有界工作状态：

- 最近用户指令与运行摘要；
- 当前步骤、已完成步骤；
- 已修改文件与文件指纹；
- 最近测试、构建和视觉反馈；
- 最近工具失败、未解决问题；
- 最近 Checkpoint 与下一步建议。

Working State 同时写入 Goal 和 Run Checkpoint。旧 Checkpoint 没有该字段时不会清空新状态。

## 2. 活跃 Goal 默认续跑

除非用户明确输入“新任务”等切换意图，活跃 Goal 的普通反馈默认：

- 复用同一 Goal；
- 复用原 Task；
- 复用同一 Platform Run；
- 注入原根计划和 Working State；
- 从可恢复 Checkpoint 继续。

致命错误不会被当作可恢复 Checkpoint 复活，但后续消息仍可绑定原 Goal，并使用其权威计划与工作状态重新开始安全执行。

## 3. Tool Error 分级

工具错误分为可恢复和致命两类。

可恢复示例：目标文本变化、文件未找到、参数问题、读取超限、临时不可用、超时、Plan 状态冲突。它们会保存 Checkpoint，并以 continuable handoff 结束。

致命示例：权限或策略拒绝、需要审批、未知副作用、Receipt 核验失败、用户取消。它们不会被自动恢复。

## 4. Goal-owned Root Plan

顶层根计划由 Goal Runtime 持有，具有稳定 `rootPlanId`。

`update_plan` 只允许：

- 使用同一批步骤 ID 和标题；
- 向前推进状态；
- 恢复 blocked/needs_input 步骤；
- 保留 completed 步骤。

禁止新增、删除、改名、替换或回退根步骤。

## 5. Dedicated Replan

结构变化必须调用 `replan_goal`，并同时提供：

- `reason`：为什么现有结构不再适用；
- `failedAssumption`：失效假设或变化的用户约束。

已完成步骤不可回退。被替换的未完成步骤保留为有界 `superseded` 历史。

## 6. Plan Control Serialization

`update_plan`、`replan_goal` 和 `update_step_work` 使用同一个独占控制面锁：

```text
control:goal-plan
```

Plan 操作执行时不会与读取、写入或另一个 Plan 操作重叠。排队中的 Plan 操作还是队列屏障，后来的普通工具不能插队。

## 7. Unchanged-file Read Cache

同一长期 Task 的 `read_text_file` 和 `read_multiple_files` 使用持久化读取缓存。缓存按以下信息验证：

- 规范化绝对路径；
- 读取范围与编码；
- 文件大小；
- mtime 与 ctime；
- SHA-256 输出证据。

文件未变化时返回 `cacheReused: true`，不再次从工作区读取；文件发生变化后自动失效。缓存限制为 256 项、约 32 MB。

## 8. 测试入口

新增：

```bash
npm run test:p0-continuity
```

覆盖五轮连续反馈、根 Plan Authority、Replan、Plan 串行屏障、Working State、错误分级、RunEngine 续跑和未变化文件读取缓存。该入口已加入 Windows 与 Linux GitHub CI。
