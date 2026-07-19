# Tool Runtime 代码审计与长任务稳定性方案

## 1. 本轮审计范围

本轮检查覆盖以下链路：

- `AgentRuntime`：Run 创建、流式输出、取消、最终化、检查点和 Response 状态。
- `RunEngine` / `SegmentExecutionLoop` / `LongTaskOrchestrator`：长任务分段、继续执行、无进展熔断和终止状态。
- `createAgentToolSession`：工具注册、启用过滤、计划、结果存储和运行时组装。
- `ToolExecutor`：参数校验、策略、预算、并发、超时、取消、重试和生命周期事件。
- `ToolEventStore` / `ToolResultStore`：工具事件与大结果的持久化、恢复及归属隔离。
- `RunActivityStore`：Conversation、Response 和活动面板使用的公开活动投影。
- `AsyncPersistenceQueue`：会话、记忆和工具事件的异步落盘。

## 2. 当前 Tool Runtime 的实际运行机制

```text
用户消息
  -> AgentRuntime 创建 Run / Goal / Task
  -> 组装上下文与模型
  -> 创建 Tool Session
       -> ToolRegistry 冻结本轮可用工具
       -> RunPlanStore 保存可执行计划
       -> ToolPolicyEngine 做运行前授权
       -> ToolBudget / ToolScopeBudget 做全局、Step、Batch 限流
       -> ToolExecutor 执行工具
            -> queued
            -> running / retrying
            -> completed / failed / cancelled
            -> ToolEventStore 记录生命周期
            -> ToolResultStore 内联或保存大结果引用
  -> SegmentExecutionLoop 执行一个或多个 Segment
       -> 每个 Segment 最多若干模型 Step
       -> LongTaskOrchestrator 判断完成、继续、检查点或失败
  -> RunEngine 在需要时执行最终总结
  -> AgentRuntime 持久化 Assistant 消息和检查点
  -> Conversation / Response / Activity 面板消费结构化状态
```

当前设计已经具备长任务的主要骨架：有限重试、写操作幂等限制、并发键、全局及局部预算、上下文压缩、分段执行、无进展终止、可继续检查点以及工具结果分页。

## 3. 本轮已修复的问题

1. **流式文本未进入状态和检查点**  
   `finalText` 初始值为空字符串，原逻辑不会回退到 `currentStepText`。现在状态展示、运行中检查点和“停止后保留部分回复”统一使用当前可见文本。

2. **工具批次错误聚合**  
   旧逻辑只要历史上出现过工具，后续模型说明都标记为 `between_tools`，多个工具批次会长期粘在一起。现在每个“文本 + 工具调用”的模型 Step 都明确开启新的 `before_tools` 批次，最终文本到达时关闭活动批次。

3. **活动说明跨批次误去重**  
   原逻辑只比较文字，相同说明会阻止新批次建立。现在按“内容 + 阶段 + batchId”去重。

4. **计划更新监听器反向破坏计划工具**  
   Plan 已经写入后，渲染器或监听器抛错会让 `update_plan` 看起来执行失败。现在监听器错误被隔离，计划事务本身保持成功。

5. **JSONL 单行损坏导致全部工具历史无法恢复**  
   现在逐行恢复有效事件，忽略异常退出留下的截断行，并保持后续 sequence 连续。

6. **大结果归属校验过于宽松**  
   缺失 task/workspace/segment 归属的旧结果可能被有作用域的 Store 接受，内存缓存也绕过了归属检查。现在磁盘和内存读取使用同一套严格归属规则。

7. **最终持久化失败仍然关闭队列**  
   原 `close()` 即使写入失败也会注销队列，未保存数据失去重试机会。现在失败时保留 pending 状态；应用退出会进行有限次数全局重试并报告仍未写入的队列。

## 4. 长 Tool Runtime 的主要剩余风险

### P0：崩溃恢复仍不是精确续跑

当前检查点主要保存压缩后的 Plan、工具摘要和编排快照。应用崩溃后可以“基于状态重新规划”，但不能保证从准确的 Segment/Step 指令位置继续，也不能判断一个中途失联的写工具究竟“未执行”还是“已执行但结果未返回”。

建议增加：

- Segment Journal：每个 Segment 的 `prepared -> running -> committing -> committed` 状态。
- Tool Call Lease：记录 callId、幂等键、开始时间、心跳和过期时间。
- 写工具收据：写操作完成后先持久化 receipt，再向模型返回结果。
- 启动恢复器：扫描未完成 Run，将不确定写操作标为 `needs_reconciliation`，禁止盲目重放。

### P1：高频状态广播和全量投影会随运行时长放大

每个文本 chunk 都会触发状态广播，而状态中包含 Plan、工具记录、Activity 快照和 Orchestration。长任务下容易形成 O(文本 chunk × 活动历史) 的复制与 IPC 压力。

建议增加：

- 状态广播节流到 30–60 ms，并合并同一帧更新。
- IPC 改为增量事件，完整 snapshot 仅用于窗口首次连接或校验恢复。
- Activity 只保留最近若干公开事件，历史事件落盘并分页读取。
- Orchestration snapshot 区分 `compact` 与诊断详情，普通 UI 不传完整 Step 列表。

### P1：事件与结果存储缺少主动容量治理

工具 JSONL、内存事件数组和任务结果目录主要依赖时间清理，没有单 Run 大小上限、滚动文件或总目录配额。

建议增加：

- JSONL 按大小滚动并建立 manifest。
- 每个 task、workspace 和全局结果目录设置字节配额。
- 超限时优先删除已过期、已完成且无引用的结果。
- Activity/Event 内存采用 bounded projection，而持久日志保持 append-only。

### P2：超时只能终止等待，不能终止不合作的底层操作

`runWithAbort` 能让 Runtime 不再等待一个永不结束的 Promise，但不能强制停止忽略 AbortSignal 的第三方库、子进程或网络请求。

建议增加：

- 所有内置工具必须通过统一的 abort-aware I/O 适配层。
- 子进程工具使用独立进程组并在超时后分级终止。
- 对外部 Provider 和工具增加 heartbeat、stalled 状态和 circuit breaker。
- 连续失败按 provider/tool/host 分桶熔断，而不是只在单次调用内重试。

### P2：无进展判断偏结构化，缺少任务语义

当前主要依据 Plan 状态及去重后的成功工具签名判断进展。对于“读取不同页但摘要相同”“工具成功但没有推进目标”等情况，可能误判。

建议把进展拆成：

- 结构进展：Plan 状态迁移。
- 证据进展：新增 resultId、文件版本或实体集合。
- 目标进展：模型以受限 schema 声明本段完成了什么、剩余什么。
- 失败进展：新错误类别是否提供了可行动信息。

## 5. 推荐实施顺序

第一阶段先实现 **Segment Journal + Tool Lease/Receipt + 启动恢复器**，解决长任务最危险的重复写入和崩溃后不确定状态。

第二阶段实现 **状态增量广播 + Activity 有界投影 + 日志滚动与配额**，解决任务越长越卡、内存和磁盘持续增长的问题。

第三阶段再做 **按工具/Provider 的熔断、心跳、故障转移和语义进展评分**。

## 6. 测试建议

除现有单元、集成和 Electron E2E 外，建议建立故障注入测试矩阵：

- JSONL 写到一半时进程退出。
- checkpoint 写入第一次失败、第二次恢复。
- 工具忽略 AbortSignal 且 Promise 永不结束。
- 写工具实际成功但返回通道断开。
- 同一幂等键在应用重启后再次提交。
- 1000+ 工具生命周期事件下的内存、IPC 频率和 UI 响应。
- Segment 边界、模型超时、Provider 429/5xx 与用户取消同时发生。

稳定性的核心不是简单提高 `maxSteps` 或 `runTimeoutMs`，而是让每个不可逆操作都可识别、可核对，让每个运行状态都可恢复，并让 UI 与持久化只消费有界、增量的数据。
