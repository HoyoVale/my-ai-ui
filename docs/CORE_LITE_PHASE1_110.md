# Core Lite 1 — Advanced Entry Cutoff

本阶段基于 `my-ai-ui(108)` 建立 `runtime-core-lite` 分支的第一条稳定基线。

## 一、阶段目标

保留：

- 基础 Agent Runtime；
- Tool Runtime、审批、安全策略、Receipt 与恢复日志；
- Workspace 读取、写入、命令与 Git 工具；
- MCP；
- Skills 与 Capability Resolution；
- Memory；
- Conversation、Context、Regenerate 与 Stop；
- ChatGPT/Codex 风格工具卡片、命令输出与 Diff。

停止以下高级能力进入生产工作流：

- Goal Runtime；
- Root Plan、子计划与计划工具；
- Platform Kernel；
- Supervisor、Worker、Reviewer、Integrator；
- Long-running Agent；
- Worktree 编排；
- Platform IPC；
- 高级功能的普通用户 UI 和设置入口。

高级源码暂时保留，方便高级分支继续维护和后续按 Commit 回移。本阶段不做物理删除。

## 二、模型上下文简化

System Prompt 不再要求模型创建 Goal 或 Plan，也不再指导模型调用：

```text
update_plan
replan_goal
update_step_work
```

复杂任务只使用简短自然语言进度，例如：

```text
正在检查项目
正在修改文件
正在运行验证
```

旧会话中即使存在 `goal`、`rootPlan` 或 Plan State，`ContextAssembler` 也不会将它们注入新的模型请求。

## 三、Tool Manifest 与 Tool Session

新增统一 Core Lite 配置：

```text
electron/config/coreLite.js
```

计划工具会在三个层面被过滤：

1. Built-in Tool Registry 不创建计划工具定义；
2. `SAFE_TOOL_CATALOG` 不暴露计划工具；
3. 旧设置即使把计划工具标记为启用，也无法重新开启。

保留的 Agent 内部支持工具：

```text
read_tool_result
```

普通工具调用不再要求存在 `in_progress` Plan Step：

```text
用户消息
→ 模型选择工具
→ Tool Runtime 执行
→ 工具结果返回模型
→ 最终回复
```

历史 `initialPlan` 会被忽略，Tool Record 不再附加 `planStep`。

## 四、Platform 生产入口切断

以下入口已经移除：

- Electron 启动时不再启动或恢复 Platform Kernel；
- 不再启动 Long-running Agent 调度；
- 不再注册 Platform IPC；
- Agent Runtime 不再创建 Delegation Tool；
- Agent Run 不再创建或同步 Platform Run；
- Conversation Manager 不再绑定 Platform Completion Authority；
- 应用退出时不再调用 Platform/Worktree shutdown。

高级模块文件仍在仓库中，但从生产入口不可达。

## 五、UI 简化

Conversation 与 Input 移除：

- Goal 按钮和 Goal 编辑页；
- Plan Dock；
- TaskPanel Plan 区域；
- Platform Dock；
- Worker/Subplan 开发者展示；
- Goal Token 指标；
- Platform、Agent、Worktree、Review、Artifact 等 Slash 命令。

Model 设置仅保留：

- 当前会话主模型；
- 新会话默认模型；
- Provider 与模型参数。

不再展示 Worker 模型、Worker 并发和多 Agent 预算。

## 六、兼容策略

本阶段不升级 Conversation Store Schema。

历史数据中的以下字段允许继续存在：

```text
goal
planState
executionThread
executionThreads
routingDecisions
platformRunId
```

Core Lite 生产路径不再使用 Goal、Plan 或 Platform 字段。保留历史数据可以：

- 安全切回高级分支；
- 避免一次性破坏用户会话；
- 为 Core Lite 3 的正式数据迁移留出观察期。

## 七、测试主线调整

新增：

```powershell
npm run test:core-lite1
```

覆盖：

- 高级入口不可达；
- Agent 消息兼容；
- 真实 Tool Loop；
- Tool Session；
- Tool Manifest 与 Capability；
- 命令与 Diff UI；
- MCP Registry；
- Skills；
- Memory。

`npm run check:full` 不再运行 Goal、Supervisor、Long-running、Platform 和 Worktree 的生产 E2E，改为保留：

- Tool Runtime 崩溃恢复；
- Tool 写入崩溃矩阵；
- Runtime Benchmark；
- Electron Smoke；
- Electron Runtime 崩溃恢复；
- Conversation 与审批写入 E2E。

高级模块的独立历史单元测试仍保留，确保源码没有在本阶段被破坏。

## 八、阶段边界

Core Lite 1 只负责“切断入口”。以下工作留到后续阶段：

### Core Lite 2

- 简化 AgentRuntime；
- 移除 Goal/Plan/Platform/Execution Model 的运行时状态；
- 用轻量 AgentRunSession 替代高级编排。

### Core Lite 3

- 物理删除高级模块；
- 清理 Store 字段和迁移逻辑；
- 删除高级 IPC、Preload Channel 与死代码。

### Core Lite 4

- 重建精简测试主线；
- 清理高级文档与历史脚本；
- 完成最终性能和 Electron E2E 验收。

## 九、验证结果

从原始 `my-ai-ui(108)` 重新复制，只应用本阶段变更文件后完成冷覆盖验证。

基础与入口回归：

```text
Core Lite、Message、MCP Registry、Memory、命令与 Diff：21/21
Core Lite 与高级入口源码契约：55/55
冷覆盖综合源码契约：72/72
```

既有结构与 UI 回归：

```text
Phase 2 AgentRuntime：26/26
Phase 3 Core Runtime：71/71
Phase 4 Conversation UI：33/33
Phase F Codex Tool UI：25/25
Phase G Routing：91/91
Stability P0：65/65
```

静态检查：

```text
变更 JS/JSX 解析：52 个文件通过
尾随空白：0
冷覆盖文件差异：0
```

当前上传包不包含完整 `node_modules`。尝试执行完整 `npm test` 时：

```text
tests 715
pass 676
fail 39
Assertion failures 0
```

39 项全部在加载阶段缺少以下依赖：

```text
ai
zod
react
@modelcontextprotocol/sdk
ajv
adm-zip
```

因此本环境没有宣称完整 Oxlint、Vite Build、真实 Skill/MCP 集成测试或 Electron E2E 全部通过。完整依赖环境应执行：

```powershell
npm run test:core-lite1
npm run check:full
```
