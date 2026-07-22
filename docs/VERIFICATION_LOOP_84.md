# Verification Loop 3.0 — 84

84 把 79–83 的“可恢复执行、隔离开发、集成审查和后台平台”收口为不可绕过的非视觉验证闭环。

## 失败分类与重规划

平台将失败归入六类：

- `implementation`：实现本身失败；
- `test`：测试、构建、Lint、类型检查或 E2E 失败；
- `environment`：命令缺失、权限、网络、端口、D-Bus、显示服务等环境问题；
- `conflict`：Git 集成、发布目标或资源租约冲突；
- `evidence`：Reviewer、验收或完成证据不足；
- `requirements`：需求存在歧义或必须等待用户输入。

后台 Job 失败后先写入结构化 `Failure`，再由单独的 `replanner` AgentRun 生成受约束的 Task Graph 修订。Replanner 不修改代码，也不能绕过依赖、最大重规划次数、冲突阻塞或用户输入边界。相同未解决失败不会重复创建无限任务。

## Artifact 与 Evidence

Artifact 现在记录：

- 来源 Task 和 AgentRun；
- Commit 与最终 integration digest；
- Tool receipt ID；
- Artifact digest；
- Goal revision 与 Task Graph revision。

每条 `Done when` 必须通过 `Evidence` 明确绑定至少一个当前有效 Artifact。只有 verifier 判定通过还不够；找不到相应 Tool receipt、集成发布 Artifact 或用户确认 Artifact 时，Platform Kernel 返回 `platform-criterion-evidence-required`，主 Task 保持未完成。

Worker 工具收据、Worker Commit、集成结果、独立 Review 和工作区发布均作为不同 Artifact 保存。Reviewer 批准时必须返回非空证据，并生成归属于 Reviewer AgentRun 的独立 Review Artifact。

## 失效规则

以下变化会清除旧完成许可并使旧 Evidence 失效：

- Goal revision 或 `Done when` 改变；
- Task Graph 增加或被 Replanner 修订；
- 新代码 Artifact 出现；
- 集成 Commit、digest、状态或输入 Artifact 改变；
- Evidence 集合改变。

失效后的 Artifact 仍保留供审计，但不能再次作为当前完成证据，除非在当前 Goal、Task Graph 和最终集成结果上重新生成。

## 最终完成签名

Completion Authority 的 HMAC 签名升级到 v2，绑定：

- Goal ID 与 revision；
- PlatformRun ID；
- 最终 integration hash；
- criterion Evidence hash；
- Artifact manifest hash；
- Task Graph hash；
- 独立 Review hash；
- verifier version 与签发时间。

Conversation 通过 Platform Kernel 的当前状态验证入口验签。即使旧签名本身的 HMAC 未被篡改，只要代码、证据、任务图或集成结果已经变化，也会被判为 `completion-signature-stale` 或 `completion-signature-superseded`。没有当前许可时，Goal 和 PlatformRun 都不能进入 `completed`。

## UI

普通视图显示当前有效验收证据数量和完成签名状态。开发者视图额外展示 Artifact、Evidence、Replanner 修订、Commit、digest、receipt 和日志，便于定位完成门为何通过或被阻止。

## 85 边界

84 只完成非视觉证据闭环。真实 Electron 窗口交互、DOM、截图、控制台和网络错误 Artifact 属于 85，不在 84 中以模拟结果冒充完成。
