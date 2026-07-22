# Token Ledger 与 Tool Scheduler 1.0

> 实施基线：`my-ai-ui(93)`  
> 对应阶段：Agent Runtime Integration P1

## 1. 目标

本阶段解决黑洞 3D 压力测试暴露的两类底层问题：

1. Context 面板只统计聊天正文与静态提示词，遗漏 Tool Schema、工具参数、工具返回和 Provider 实际 Usage；
2. 多个工具主要依赖单一字符串并发键，缺少路径级读写锁、父子路径冲突和控制面队列屏障。

## 2. Token Ledger

每个 Assistant Run 创建一份 `TokenLedger`，记录：

- Provider 请求次数和模型步骤数；
- 实际 input/output/reasoning/cached/total tokens；
- 静态上下文估算；
- Tool Schema 估算；
- Tool 参数与 Tool Result 分开估算；
- Context Compaction 前后变化；
- 工具调用数、返回数和读取缓存复用次数；
- 有界的步骤与工具账本事件。

账本会随 Assistant Message 持久化，并按 `runId` 增量汇总到 Goal。相同 Run 重复写入检查点时只更新差值，不重复累计。

Conversation Context Inspector 现在分别展示：

- 当前 Run Provider 实际用量；
- 当前 Run Tool Schema、参数、返回估算；
- 当前 Run 缓存复用；
- 当前 Goal 累计实际 Token 和 Run 数。

Provider 不返回 Usage 时，实际字段保持 0，估算字段仍可用于诊断；不会把字符估算伪装成 Provider 实际值。

## 3. Tool Scheduler

`ToolExecutor` 的执行入口统一切换到 `ToolScheduler`。调度资源支持：

- `shared`：多个安全读取可以并行；
- `exclusive`：写入与冲突读取互斥；
- 多资源原子获取；
- 同路径和父子路径冲突；
- 全工作区读写冲突；
- 全局 Plan 控制面屏障；
- 排队屏障，后来的普通工具不能插队；
- 保留旧 `exclusiveConcurrency` 的全局独占语义。

策略概要：

- 不同文件读取：可以并行；
- 同文件多个读取：可以并行；
- 同文件读写：互斥；
- 父目录删除与子文件读取：互斥；
- 不同文件写入：可以并行；
- Workspace 搜索与任意写入：互斥；
- `apply_patch`、受控工作区命令：全工作区写屏障；
- `update_plan`、`replan_goal`、`update_step_work`：全局控制面屏障。

P0 的文件 Hash/mtime 读取缓存继续复用；写入成功后仍会使相关缓存失效。P0 的可恢复工具错误分类也保留在 RunEngine 中，普通工具错误不会自动摧毁整个 Goal。

## 4. 数据版本

- Conversation Store：v19 → v20；
- Goal Schema：v5 → v6；
- Token Ledger：v1。

旧会话和旧 Goal 会自动补齐空 Usage，不丢失已有消息、Plan、Checkpoint 或验证数据。

## 5. 测试

新增：

- `tests/agent/tokenLedger.test.js`；
- `tests/tools/toolScheduler.test.js`；
- `tests/regression/tokenLedgerScheduler94.test.js`；
- `npm run test:p1-ledger-scheduler`。

验收覆盖：

- Provider Usage 正确累计；
- 工具参数与返回分项估算；
- Tool Schema 独立计入预算；
- Assistant Message 持久化与有界迁移；
- Goal 按 Run 去重和增量更新；
- 同路径读写、父子路径和全工作区冲突；
- Plan/Legacy Exclusive 队列屏障；
- 未变化文件读取缓存复用与写后失效；
- Goal、Supervisor、Long-running 崩溃恢复回归。
