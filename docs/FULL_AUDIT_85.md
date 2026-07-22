# my-ai-ui 85.1：稳定性、Runtime 与一致性审计

日期：2026-07-22

## 结论

本轮以 `my-ai-ui(85).zip` 为基线，审查了 Goal、Coding 长任务、多 Agent、后台 Job、Worker/Reviewer 预算、代码重复、未使用入口、README 与真实 Electron E2E。核心架构没有发现需要推倒重做的问题；主要风险集中在真实布局断言、人工验收状态与 Runtime 预算执行时机。

本轮修复后，Coding 本地平台的功能闭环比 85 基线更完整，但视觉质量仍需后续 Visual Verification 在真实窗口、DOM、截图与控制台层验证。

## 已修复问题

| 级别 | 问题 | 根因 | 修复 |
| --- | --- | --- | --- |
| 高（CI 阻断） | Linux Electron E2E 报“Goal 人工确认按钮不应被状态圆点样式压成竖排” | 真实字体与缩放环境下，按钮只有隐式内容宽度；静态正则测试只证明存在 `nowrap`，不能保证计算宽度 | 人工确认按钮增加独立 test id、60px 最小宽度、26px 最小高度及固定 flex 行为；E2E 失败信息输出完整计算布局 |
| 高 | 用户确认人工标准后可能丢失 Goal 身份、平台运行和既有测试证据 | `manualSatisfied` 被错误纳入 Goal 规格身份与 Platform criterion hash | 人工确认改为证据状态；保留 Goal id、revision、platformRunId 和其他标准的证据，只使最后验证结果进入待重验状态 |
| 高 | 只剩人工确认时仍自动继续多个 Segment | Verifier 将人工标准视为普通缺证据，Orchestrator 继续尝试模型无法完成的工作 | 当所有剩余失败项都是 `manual` 时，立即以 `needs_input` 停止并等待用户 |
| 高 | Worker Token/步骤预算只能在全部 Worker 完成后事后判定 | Job handler 在 Supervisor 完整返回后一次性汇总 usage | Worker 每个模型步骤和每个任务结束时递增记账；预算超限通过 Job 的 AbortSignal 中止后续步骤与依赖任务 |
| 高 | Reviewer 不受后台 Job 取消和时间预算约束 | IntegrationCoordinator 为 Reviewer 新建了独立且永不取消的 signal | Reviewer 继承 Job signal，usage 进入同一预算链 |
| 中 | 默认 Worker 步骤预算与最大正常工作流不一致 | 4 Worker × 8 步 + 集成 1 步 + Reviewer 8 步 = 41，旧默认仅 40 | 默认改为 48，保留 7 步重试余量；默认值与 UI/校验范围集中到一个共享模块 |
| 中 | Model 设置把整次多 Agent 预算写成“单次任务预算” | 文案无法区分单 Worker 与整个 delegation workflow | 改为“一次多 Agent 运行 Token/步骤/时间预算” |
| 中 | AgentRuntime 与 ModelWorkerRuntime 通过大型 Tool barrel 获取一个函数 | 扩大主进程启动依赖图与隐式公共面 | 改为直接导入 `createAgentToolSession`；保留旧 barrel 作为兼容入口，不在本轮破坏性删除 |
| 低 | README 仍描述“第一阶段”、旧 Provider 路由和仅运行 `npm run check` 的 CI | 文档未随 79–85 演进 | 更新当前架构、Provider、Agent 目录和 Windows/Linux E2E 矩阵 |

## 3D 黑洞 Coding 任务审查

上传的源码 ZIP 不含 Electron `userData` 下的 `conversations.json`、Platform Journal 或 Tool Runtime 日志，因此无法逐条复盘该真实对话。根据截图与对应代码链，可确认以下问题：

1. `构建全部成功 / 测试全部成功 / 目标完成` 中，前两项可由命令收据验证，`目标完成` 是语义性、循环式标准，只能人工确认。
2. 旧实现会为最后一个人工标准继续无效执行，并在确认时重置证据；本轮已修复。
3. 对 3D 渲染项目，更合适的 Done when 应写成具体命令和可观察结果，例如 `npm run build`、测试命令、应用能启动、画面无控制台错误、用户确认黑洞视觉效果。最后三项要由后续 Visual Verification 或用户确认完成。
4. 该类任务通常包含依赖安装、构建、启动服务和视觉判断；30 分钟时间预算合理但偏保守。超过边界时应保存 Checkpoint 后由用户继续，而不是偷偷扩大预算。

如需逐条审查模型是否重复读文件、错误委派、计划漂移或过早宣称完成，需要另行导出该会话及 Platform/Tool 日志。

## Runtime 参数审查

| 参数 | 当前默认 | 评价 |
| --- | ---: | --- |
| 主 Agent 每 Segment 最大步骤 | 6 | 合理；能形成短反馈周期 |
| 主 Agent 最大 Segment | 24 | 合理；绝对上限 144 模型步骤，另受 30 分钟边界约束 |
| 无进展 Segment | 3 | 合理；本轮新增“仅人工确认”提前停止，避免浪费这 3 段 |
| 主运行时间 | 30 分钟 | 适合本地中型 Coding 任务；长项目应通过 Checkpoint 继续 |
| 受限 Tool 调用 | 100 | 合理；覆盖真实修改和验证，同时限制异常工具循环 |
| Tool 紧急总熔断 | 2000 | 只作为包含免计量读取的最终保险；仍受每步 16、每批 24 与 Segment 上限约束 |
| Tool 并发 | 4 | 合理；高于 Worker 默认并发但仍有明确上限 |
| Worker 并发 | 2（可调 1–4） | 对普通桌面机器更稳妥 |
| 多 Agent Token 预算 | 400,000 | 对最多 4 Worker + Reviewer 属于宽松上限；依赖 Provider 返回 usage |
| 多 Agent 步骤预算 | 48 | 可覆盖最大正常闭环 41 步并保留 7 步余量 |
| 多 Agent 时间预算 | 30 分钟 | 合理；现在同时约束 Worker 与 Reviewer |
| 单 Worker/Reviewer 最大步骤 | 8 | 合理；Worker 必须处理有界任务，复杂任务应拆分而不是无限延长 |

## 代码健康度

- 分析范围：309 个 JavaScript/JSX/CSS 文件，约 68,795 行。
- 重复扫描：6 个 clone，重复行约 0.30%。不存在值得进行大规模机械去重的结构性重复。
- Node 内置覆盖率：行 86.22%、分支 64.43%、函数 86.98%。分支覆盖的主要缺口在 Electron 窗口、异常恢复和外部服务失败分支。
- 未使用扫描列出 5 个文件和 69 个导出；其中 E2E fixture 是脚本入口，兼容 shim 和大量导出被测试、旧补丁路径或公共 barrel 保留，不能按扫描结果盲删。
- `AgentRuntime.js`、`PlatformKernel.js`、`validateSettings.js` 和 `Conversation.css` 仍偏大，但重复率很低。下一轮拆分应以职责边界和测试可读性为目标，而不是单纯追求行数。
- 构建最大业务 chunk 仍是 `taskActivity`，约 437kB（gzip 约 131kB）；可在视觉阶段按 Markdown/活动详情边界继续懒加载。

## 保留风险

1. 当前容器禁止 D-Bus、X display、NETLINK 和字体缓存写入，真实 Electron BrowserWindow 无法在本地启动；必须以 GitHub Linux/Xvfb 和 Windows 原生 E2E 为最终窗口级证据。
2. Provider 不返回 usage 时只能在任务结束时补记 Token；时间预算和 AbortSignal 仍是始终有效的硬边界。
3. 真实黑洞项目对话不在 ZIP 内，本报告没有虚构其消息内容或运行日志。
4. 视觉正确性、WebGL/Canvas 画面、截图差异和控制台错误尚未进入 Completion Authority，这仍是后续 Visual Verification 的范围。

## 验收命令

```bash
npm run check
npm run test:e2e:platform-crash
npm run test:e2e:worktree-crash
npm run test:e2e:runtime-crash
npm run test:e2e:runtime-write-crash
npm run test:benchmark
npm audit --json

# Linux CI
xvfb-run -a npm run test:electron:ci
xvfb-run -a npm run test:e2e:electron-runtime-crash
xvfb-run -a npm run test:e2e

# Windows CI
npm run test:electron
npm run test:e2e:electron-runtime-crash
npm run test:e2e
```
