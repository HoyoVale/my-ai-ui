# Execution Runtime Stability Roadmap

## 目标

让模型可以犯错，但 Runtime 不允许错误成为应用事实：

```text
Tool 可以失败
→ 最终回复不能声称成功

应用可以崩溃
→ 恢复后不能重复副作用

用户可以改变目标
→ 新目标不能污染旧 Thread

UI 保持简洁
→ 开发者仍能追溯事实链
```

## P0 — Truth Consistency（已完成）

- Task Boundary Classifier；
- Objective Compatibility Gate；
- Completion Evidence Gate；
- Activity Terminalizer；
- Message/Run 状态分离；
- 真实黑洞→水项目 Fixture。

验收：任务边界、Goal、工具证据、Run Outcome、最终回复一致。

## P1 — Recovery and Continuation

计划：

- 区分 recoverable/fatal failed Thread；
- 用户提供相关错误日志时创建同 Thread Retry Run；
- Tool Side-effect Reconciliation；
- Steering Queue 在安全边界正式接入；
- Renderer 重连与事件补齐。

验收：失败任务可正确续接，崩溃恢复不重复副作用。

## P2 — Response Projection

计划：

- 更完整的 Final Claim Extractor；
- Evidence-linked Final Summary；
- Mutation Receipt 与最终文件列表强绑定；
- Tool Card 结果和 Final Diff 来自权威投影；
- 失败、可继续、等待审批使用固定事实模板。

验收：用户看到的成功声明均可追溯，每个真实修改均被披露。

## P3 — Protocol Hardening

计划：

- Runtime/Renderer capability handshake；
- Event、Projection、Protocol 版本；
- Replay 与 backward compatibility；
- 不兼容时只读恢复；
- 属性化状态机测试。

验收：Runtime 与 Renderer 可独立升级，旧数据可安全恢复。

## 实施顺序

```text
P0 Truth Consistency       已完成
P1 Recovery & Continuation 下一阶段
P2 Response Projection
P3 Protocol Hardening
```
