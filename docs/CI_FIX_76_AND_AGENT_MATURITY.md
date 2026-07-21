# my-ai-ui 76：CI 修复与 Agent 成熟度评估

日期：2026-07-22

## 1. CI 失败结论

Linux 与 Windows 的 Playwright Electron E2E 都停在：

```text
Text not found: E2E_REPLY_1:first message
```

这不是模型、会话路由或测试超时问题，而是 Response 窗口首次加载时的 IPC 订阅竞态。

原流程是：

1. 主进程创建 Response BrowserWindow；
2. `did-finish-load` 触发后，主进程立即刷新缓存的 `STREAM_START/CHUNK/END`；
3. React 页面随后在 `useEffect` 中订阅这些频道。

`did-finish-load` 只代表文档完成加载，不保证 React effect 已执行。在 CI 的快速机器上，内置 E2E 回复约 105 ms 即可生成完成，因此整条回复可能在监听器安装前发完。窗口已经存在，但文本事件永久丢失，两个操作系统会在同一点稳定失败。

## 2. 实施的修复

增加显式 `response-renderer-ready` 握手：

- Response React hook 先注册全部流事件监听器，再发送 ready；
- 主进程收到 ready 后才把排队的开始、文本块、结束事件按原顺序刷新；
- IPC handler 验证信号必须来自真实 Response 窗口；
- 页面重新加载时重新进入排队状态，避免热重载期间发送给旧文档；
- 新增回归契约，禁止恢复为 `did-finish-load` 直接刷新消息。

涉及文件：

- `electron/shared/ipcChannels.cjs`
- `electron/preload/preload.cjs`
- `electron/ipc/handlers/responseIpc.js`
- `electron/windows/response/index.js`
- `electron/windows/response/ResponseWindowController.js`
- `src/Response/hooks/useResponseStream.js`
- `tests/regression/responseLifecycleContract.test.js`

`my-ai-ui(76).zip` 还缺少上一版已生成的 `public` 图标资源，但保留了图标契约测试。本交付包已恢复 floral wisteria 的 PNG、ICO 与 favicon 资源，使源码包和测试重新自洽。

## 3. 验证结果

| 检查 | 结果 |
| --- | --- |
| Node 测试 | 597/597 通过 |
| Response 握手专项回归 | 通过 |
| IPC 契约 | 通过 |
| Lint | 通过 |
| Vite 生产构建 | 通过 |
| Tool Runtime crash recovery | 通过 |
| 原子写 crash matrix | 通过 |
| Tool Runtime benchmark | 通过 |
| Electron GUI E2E | 当前 Work 容器被 D-Bus/Unix socket 权限阻止，需 GitHub Actions 复跑 |

## 4. 当前 Agent 是否达到成熟中期

结论：**核心运行时已经达到成熟中期的入门线；完整产品仍是中期，而不是后期成熟 Agent。**

它已经明显越过“聊天外壳 + 几个工具”的早期阶段。尤其成熟的是工具执行内核，而不是 UI 数量：

- Goal → Task → Segment → Step → Tool Call 分层；
- 自动多 Segment 继续、无进展检测、超时和预算边界；
- 根计划与内部子计划、计划持久化及恢复；
- 工具并发、有限重试、重复调用抑制和熔断；
- 原子写、乐观哈希、回执、租约、journal、checkpoint 与崩溃恢复；
- 写入/外部/破坏性操作审批；
- MCP 健康检查、恢复、工具 manifest 变更追踪；
- Prompt authority 分层、上下文预算、压缩、Memory 与 Skill；
- 面向用户与开发者的状态投影、流式活动和恢复 UI；
- 597 项单元、集成、契约与故障注入测试。

### 分项成熟度

| 能力 | 评分 | 判断 |
| --- | ---: | --- |
| Agent 执行循环 | 8/10 | 已能持续执行、分段续跑和收敛 |
| Tool Runtime 可靠性 | 8.5/10 | 当前最成熟的部分 |
| 权限与副作用安全 | 8/10 | 细粒度审批较完整，但还不是 OS 级通用沙箱 |
| Context / Skill / MCP | 7.5/10 | 架构清楚，生态与真实任务验证仍不足 |
| 计划、Checkpoint、可观察性 | 7.5/10 | 状态完整，Goal 语义仍偏内部化 |
| 自动验证与纠偏 | 5/10 | 能运行允许的命令，但没有强制完成门与独立验证器 |
| Coding 工具广度 | 5.5/10 | 文件与进程基础扎实，浏览器、视觉、网络开发链不足 |
| 跨平台产品稳定性 | 5.5/10 | CI 和 E2E 已建立，仍持续暴露窗口生命周期竞态 |
| 多 Agent / worktree | 2/10 | 尚未实现 |
| 云任务、GitHub、自动化生态 | 2.5/10 | 尚未形成 Codex 级平台能力 |

综合判断：

- Agent 核心引擎：约 **70–75/100**；
- 可稳定日用的个人 Coding Agent：约 **60–65/100**；
- 对标完整 ChatGPT Codex 产品平台：约 **40–50/100**。

这些数字不是代码行数比例，而是能力覆盖和可靠性判断。后半程包含浏览器验证、多 Agent、系统沙箱、云执行、真实仓库评测等高难度部分，工程量不会线性下降。

## 5. 与 Codex 的关键差距

### 5.1 Goal 目前是运行标识，不是真正的完成判定器

当前 `goalId/objective` 能跨 Segment 和续跑保存，但完成主要依据：模型停止原因、计划是否全部终态、是否存在最终文本。它无法独立证明“用户目标已经满足”。如果模型误把步骤标为完成，运行时缺少第二套客观判定。

下一步应增加 Goal Controller：

- 用户可见、可编辑、可暂停和恢复的持久目标；
- 结构化完成标准与禁止条件；
- verifier registry（测试、构建、lint、Git diff、文件断言、UI 断言）；
- 完成前强制执行相关 verifier；
- verifier 失败后自动形成新假设、更新计划并继续；
- 最终输出 evidence bundle，而不是只输出一段自然语言。

### 5.2 缺少强制验证闭环

系统提示要求“修改后运行检查”，但 Runtime 没有 completion gate 强制执行。`run_workspace_command` 默认关闭，且必须由开发者配置允许命令，因此许多真实项目中 Agent 能改文件，却可能无法运行测试。

应建立项目命令配置和完成门：检测项目 → 选择允许的构建/测试命令 → 执行 → 解析失败 → 重试 → 最终 diff review。仓库级 `AGENTS.md` 或同类规则应能声明命令、约束和 Done Definition。

### 5.3 缺少真实 UI / 浏览器反馈

当前 Playwright 主要用于项目自身 E2E，不是 Agent 可调用的浏览器工具。对于 Electron、Web 和视觉问题，Agent 无法自主打开页面、点击、截图、比较布局并继续纠错。这正是当前这类 CI 问题仍高度依赖外部截图的原因。

### 5.4 缺少多 Agent 与隔离工作区

当前是单一模型线程内部多 Segment，不是多 Agent。还没有：

- 专用探索、实现、测试、审查 Agent；
- 并行只读任务与结果汇总；
- Git worktree 隔离写入；
- Agent 间消息、取消、预算和冲突处理。

### 5.5 缺少平台层

与 Codex 产品相比，还缺云端后台任务、跨设备继续、GitHub PR/Review、hooks、自动化、连接器、浏览器/Computer Use、发布与更新、崩溃遥测、真实任务评测体系。

## 6. 推荐开发顺序

1. **先让本次 Windows/Linux E2E 变绿**，并连续多次运行验证无偶发失败。
2. **Goal Controller 2.0 + Completion Verifier**：这是从“会连续调用工具”跨到“能无人值守完成目标”的关键。
3. **Repository Guidance + Command Profiles**：支持 `AGENTS.md`、项目识别、受控测试/构建命令和完成门。
4. **Agent 可调用的 Browser/Electron 验证工具**：截图、控制台、元素断言与视觉回归。
5. **真实任务 Eval**：准备 30–100 个小型仓库任务，统计一次成功率、平均重试、误完成率、回归率和成本。
6. **多 Agent + worktree**：在单 Agent 验证闭环稳定后再加入，否则只会并行放大错误。
7. **GitHub、后台任务和自动化平台层**。

达到第 4 步并用真实 Eval 证明稳定后，可以称为“后期个人 Coding Agent”；完成第 5–7 步并具备长期运营数据后，才接近 Codex 类产品标准。

## 7. 官方对标依据

OpenAI 当前建议复杂 Coding Agent 任务明确 Goal、Context、Constraints 和 Done when，并要求 Agent 创建/运行测试、确认行为和审查 diff；仓库级约束应放入 `AGENTS.md`。Codex 的更高阶能力还包括多 Agent 编排、沙箱与审批、MCP/Skill、浏览器和云任务等。

- https://learn.chatgpt.com/guides/best-practices
- https://learn.chatgpt.com/docs/agent-configuration/agents-md
- https://learn.chatgpt.com/docs/agent-approvals-security

