# MCP 远程连接、认证与设置体验实施报告

## 本阶段目标

本阶段在既有 stdio MCP 基础上完成：

1. MCP 设置向普通用户开放，并移动到 Setting 的 AI 分组。
2. 重做 MCP 设置页，使“添加连接、连接状态、认证、工具发现”成为主要流程。
3. 增加 Streamable HTTP 远程 MCP。
4. 增加 Bearer Token、API Key 与 OAuth 浏览器授权。
5. 保持 MCP 工具统一经过 Tool Manifest 与 Tool Runtime。
6. 保留开发者模式中的高级诊断，而不把基础连接能力锁在开发者模式后。

## 设置页结构

```text
Setting
└─ AI
   ├─ Model
   └─ MCP 与连接
```

普通用户可以：

- 开启或关闭 MCP；
- 设置启动时自动连接；
- 添加远程 MCP；
- 添加本地 stdio MCP；
- 添加 GitHub 只读预设；
- 查看连接状态、工具数量与认证状态；
- 连接、断开、刷新、重新授权和删除连接。

开发者模式额外显示：

- Server ID；
- 工作目录和环境变量；
- 自定义 Header；
- OAuth Scope；
- 连接与调用超时；
- Server 日志。

## 支持的连接类型

### 远程 MCP

```text
Transport: Streamable HTTP
URL: https://example.com/mcp
```

安全约束：

- 远程地址默认要求 HTTPS；
- HTTP 只允许 localhost、127.0.0.1 或 ::1；
- 禁止 URL 用户名、密码和 Fragment；
- 连接前再次严格校验，而不是仅依赖 UI；
- 支持连接超时、调用超时、Abort 与远程 Session 结束。

### 本地 MCP

保留 stdio 配置：

```text
command
args
cwd
env
secretEnvKeys
```

本地 Server 继续由 Electron 主进程负责生命周期、日志、工具发现和退出清理。

## 认证

### 无认证

用于公开或本地可信 MCP。

### Bearer Token

以：

```http
Authorization: Bearer <token>
```

发送。

### API Key

允许配置 Header 名，例如：

```http
X-API-Key: <token>
```

### OAuth

实现了：

- PKCE；
- 随机 state；
- localhost 随机端口回调；
- 浏览器授权；
- Token 保存与刷新所需的 SDK Provider；
- 登录成功/失败回调页面；
- 退出登录与凭据清理；
- 401 后进入授权并重新连接。

OAuth、Bearer Token、API Key 和 stdio Secret 不写入普通 `settings.json`，而是使用现有 MCP Credential Store，并优先通过 Electron `safeStorage` 加密。

删除连接时会同时：

- 断开 Server；
- 清除远程认证；
- 清除该 Server 声明的 stdio Secret；
- 从设置中移除连接。

## Tool Runtime 集成

远程 MCP 与本地 MCP 使用相同路径：

```text
MCP Transport
→ McpClientManager
→ MCP Tool Adapter
→ Tool Registry
→ Tool Manifest
→ Tool Runtime
→ Journal / Receipt / Recovery
```

MCP 不会绕过：

- 单工具与 Toolset 开关；
- Schema 校验；
- 调用预算；
- Timeout 与 Abort；
- Circuit Breaker；
- Journal、Lease 与 Receipt；
- 不确定副作用恢复；
- 普通用户和开发者信息投影。

## 主要文件

### 新增

- `electron/mcp/McpOAuthFlow.js`
- `tests/regression/mcpSettingsUiContract.test.js`

### 修改

- `electron/ipc/handlers/mcpIpc.js`
- `electron/mcp/McpClientManager.js`
- `electron/mcp/index.js`
- `electron/mcp/mcpCredentialStore.js`
- `electron/preload/preload.cjs`
- `electron/settings/validateSettings.js`
- `electron/shared/ipcChannels.cjs`
- `src/Setting/Setting.css`
- `src/Setting/Setting.jsx`
- `src/Setting/components/Content.jsx`
- `src/Setting/constants/Tabs.js`
- `src/Setting/panels/McpPanel.jsx`
- `tests/contracts/ipcContract.test.js`
- `tests/e2e/conversation-flow.cjs`
- `tests/electron/preload-smoke.cjs`
- `tests/mcp/McpClientManager.test.js`
- `tests/settings/mcpSettings.test.js`

## 自动化验证

```text
Oxlint: 0 warnings, 0 errors
Node tests: 436 passed, 0 failed
Vite production build: passed
Tool Runtime crash recovery E2E: passed
Atomic-write crash matrix: passed
MCP focused tests: 19 passed, 0 failed
```

Vite 仍提示主入口 Chunk 超过 500 KB。这是现有应用代码分包问题，不影响本阶段功能；后续可通过路由懒加载和设置面板按需加载处理。


## Electron 验证

当前容器执行：

```text
xvfb-run -a npm run test:electron:ci
```

仍在 Electron 二进制下载阶段失败：

```text
Downloading Electron binary...
TypeError: fetch failed
Electron failed to install correctly
```

因此本地未进入 Preload Smoke 和真实窗口阶段。Node、MCP 协议、设置验证、构建与 Tool Runtime 故障恢复均已通过；Windows/Linux 的真实 Electron UI 仍应由 GitHub Actions 完成最终验收。

## 当前边界

本阶段完成了：

- stdio MCP；
- Streamable HTTP MCP；
- 静态 Token 认证；
- OAuth 浏览器认证；
- 普通用户 MCP 管理 UI。

尚未包含：

- Declarative HTTP Tool；
- Playwright MCP 浏览器权限域；
- MCP Registry 商店式安装；
- 企业级 OAuth 管理后台；
- 多账号账户选择器。

下一阶段适合实现 Declarative HTTP Tool，复用本阶段的凭据、远程调用、权限分类、Manifest 与 Runtime 基础。
