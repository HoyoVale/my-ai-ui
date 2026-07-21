# my-ai-ui 75：全面审查、调试与测试报告

日期：2026-07-22

## 结论

本轮完成了 Electron 主进程、预加载/IPC、安全边界、窗口布局、会话与 Agent/Tool/MCP 关键链路的代码审查，并执行了可在当前环境运行的完整自动化回归。共修复 3 类问题，接入一套 “floral wisteria” 应用图标资源。

- Lint、596 项 Node 测试和 Vite 生产构建全部通过。
- Tool Runtime 崩溃恢复与原子写入崩溃矩阵通过。
- `npm audit`：0 个已知漏洞（含开发依赖）。
- Linux/Windows 截图中的 Playwright 失败已定位并修复测试断言。
- 当前 Work 沙箱禁止创建 X/Unix 显示套接字，因此无法在本机完成真实 BrowserWindow 级 Electron E2E；项目现有 GitHub Actions 会在 Linux/Xvfb 与 Windows 原生环境运行这部分。

## 已修复问题

| 级别 | 问题 | 根因 | 修复与验证 |
| --- | --- | --- | --- |
| 高 | 渲染器 URL 信任范围过宽 | `isTrustedRendererUrl` 无条件接受 `data:`、`blob:`、`devtools:`，弱化导航与 IPC sender 信任边界 | 仅接受显式允许 origin 的 `http:`/`https:` 页面；新增回归测试覆盖不可信 scheme 和外部 origin |
| 高（CI 阻断） | Linux/Windows Playwright Electron E2E 在 `conversation-flow.cjs:644` 失败 | 输入菜单会根据可用屏幕空间向上或向下展开；旧测试只允许顶部锚定。两张截图都显示 y 坐标恰好相差 255 px，实际是底边锚定的正确布局 | 断言改为允许顶部或底部锚定，同时验证宽度不变、高度增加及展开方向正确 |
| 中（测试稳定性） | `ToolResultStore` 配额测试偶发 `ENOENT` | 第三个 `capture()` 会立即触发配额清理，测试随后还尝试修改已删除文件时间 | 先写入并固定前两个文件时间，再写第三个触发清理；验证最旧项被删除 |
| 资源接入 | Web、Electron 窗口和托盘未统一使用应用图标 | favicon 指向不存在的 SVG，BrowserWindow 未设置 icon，托盘仍使用桌宠图 | 接入透明紫藤图标、ICO、多尺寸 PNG；新增资源签名和引用契约测试 |

## 测试结果

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| `npm run lint` | 通过 | oxlint：`src`、`electron` |
| `npm run test` | 通过 | 596/596；139 suites；0 fail |
| `npm run build` | 通过 | Vite 8.1.4；375 modules；生成资源包含 icon/favicon |
| `npm run test:e2e:runtime-crash` | 通过 | Tool Runtime crash recovery |
| `npm run test:e2e:runtime-write-crash` | 通过 | 原子写入 crash matrix |
| `npm run test:benchmark` | 通过 | 10,000 events；约 2,012 append events/s；约 16,792 reload events/s |
| `npm audit --json` | 通过 | 0 info/low/moderate/high/critical |
| Node 语法检查 | 通过 | preload、E2E 与本轮修改的 Electron 文件 |
| 图标容器/构建产物检查 | 通过 | PNG/ICO 签名有效；ICO 含 7 个尺寸；图标已复制到 `dist` |
| BrowserWindow Playwright E2E | 需在 CI 复跑 | 当前 Work 沙箱禁止 X/Unix 显示套接字；CI 已配置 Linux `xvfb-run` 与 Windows 原生执行 |

## 审查范围

项目约包含 175 个 Electron JavaScript 文件、88 个渲染器 JavaScript/JSX 文件和 166 个测试文件；`electron` 与 `src` 合计约 68,945 行。人工重点审查和自动化覆盖包括：

- Electron 生命周期、窗口创建、窗口导航、新窗口、外部链接和权限策略。
- preload/contextBridge、IPC 注册、sender 信任边界和渲染器网络限制。
- Input 浮窗布局、菜单/Slash 命令、会话选择和窗口状态。
- Conversation 历史、重新生成、上下文/置顶、流式响应和 Markdown/KaTeX 渲染。
- Chat/Coding 工作区隔离、模型/Provider 配置、上下文和 Memory。
- Agent 长任务编排、计划、工具审批、结果存储、超时、配额、恢复和持久化。
- Workspace 读写边界、进程 allowlist、无 shell 执行、原子写入与回执。
- MCP stdio/HTTP、权限、配置可移植性、恢复及结果清洗。
- favicon、BrowserWindow icon、托盘 icon 和 Vite public 资源流水线。

确认的安全基线包括 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`、拒绝新窗口和权限请求、外部 URL scheme/凭据/本地私网过滤、Markdown 原始 HTML 禁用，以及工作区进程工具不通过 shell 执行。

## 图标资源

`public` 目录新增：

- `icon.png`：1024×1024 RGBA 主图标。
- `favicon.ico`：16、24、32、48、64、128、256 px。
- `favicon.png` 及 16/32/48/64/128/180/192/256/512 px PNG。
- `icon-master.png`：透明背景母版。

图形以悬垂紫藤花簇、绿色叶片和轻微闪光为核心，在小尺寸下保持清晰轮廓。

## 建议与剩余风险

1. 合并前必须让 GitHub Actions 的 Linux 与 Windows `electron-e2e` job 各跑一遍，确认真实桌面环境中的修复结果。
2. 作为纵深防御，可继续把部分目前依赖统一 trusted-origin 校验的 IPC handler 收紧为按窗口、按 channel 的 sender allowlist。
3. README 中仍有“暂未加入 Tool/MCP”的旧描述，与现有功能不符，建议下一轮同步文档。
4. 当前仓库未见完整的安装包、签名和自动更新配置；本轮已准备运行时窗口图标，但 Windows `.ico`、macOS `.icns` 的打包器配置仍应在发行流水线中单独验收。
5. `taskActivity` 构建 chunk 约 437 kB（gzip 约 131 kB），不影响正确性，但后续可按界面边界继续拆分。

## CI 验收命令

```bash
npm ci --registry=https://registry.npmjs.org/
npm run check
npm run test:e2e:runtime-crash
npm run test:e2e:runtime-write-crash
npm run test:benchmark

# Linux
xvfb-run -a npm run test:electron:ci
xvfb-run -a npm run test:e2e:electron-runtime-crash
xvfb-run -a npm run test:e2e

# Windows
npm run test:electron
npm run test:e2e:electron-runtime-crash
npm run test:e2e
```
