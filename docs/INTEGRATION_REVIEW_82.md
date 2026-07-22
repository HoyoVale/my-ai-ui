# Integration & Review 82

## 执行链

```text
Worker checkpoint commits
  → deterministic Integration Queue
  → isolated Integrator worktree
  → integration commit + digest
  → independent Reviewer read-only worktree
  → safe workspace publication
  → Completion Authority
```

## 集成规则

- 只有 `implementer` 产生且实际改变文件的 Commit 会进入队列。
- 队列顺序由任务创建时间和任务 ID 决定，不受并发 Worker 完成先后影响。
- Integrator 是宿主控制器，不调用模型决定冲突取舍。
- 任一 cherry-pick 冲突都会恢复集成 worktree 的起始 Commit，并记录冲突文件。
- 原 Worker 分支和 checkpoint Commit 始终保留，不因集成失败而删除。

## 独立审查

- Reviewer 与 Implementer 必须属于不同 AgentRun。
- Reviewer 读取最终集成 Commit，而不是某一个 Worker 分支。
- Reviewer worktree 为只读；若产生修改，审查自动拒绝。
- 审查结论包含 `approved`、摘要、发现项和证据。
- 审查记录绑定 `integrationCommit + integrationDigest`；重新集成后旧审查自动失效。

## 安全发布

集成 Commit 不会直接切换或提交用户当前分支。审查通过后：

1. 重新快照用户工作区当前树。
2. 与 Integrator 起始基线比较。
3. 若用户或其他进程在审查期间修改过工作区，停止发布并进入冲突状态。
4. 若基线一致，仅应用集成差异到工作树。
5. 验证发布后的树等于已审查集成树。
6. 验证用户分支和真实 Git index 均未改变。

因此 staged、unstaged 和未跟踪的既有用户修改会被保留；应用不会替用户提交。

## 模型与跨窗口一致性

- `主模型` 表示当前会话绑定，Input 与 Settings 通过 Conversation 广播同步。
- `新会话默认模型` 仍由全局 Settings 保存，两者不再使用相同名称混淆。
- `Worker 模型` 保持独立配置，不随当前会话主模型切换。
- 修改或删除模型配置时，ConversationManager 会刷新每个会话的模型快照；失效绑定回退到有效默认模型。
- 工作区注册或移除后同时广播 Settings 与 Conversation 状态，使 Input、Conversation、Settings 重新读取同一状态。

## 完成门

存在 Worker 代码变更时，Goal 完成许可要求同时满足：

- Integrator 已生成最终 Commit；
- Reviewer 独立批准同一 Commit 和 digest；
- 已审查差异已安全发布到用户工作区；
- 所有 Platform Task 已结算；
- 原有 Goal Verifier 的逐条验收仍通过。

缺少任一条件时，普通 Runtime、Renderer 和主 Agent 都无法签发完成许可。
