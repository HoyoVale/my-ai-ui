# Declarative HTTP Tool 实现报告

## 目标

本阶段把普通 REST API 变成可由模型调用的 Tool，而不要求用户编写 JavaScript 或部署 MCP Server。

最终调用链：

```text
Setting / Custom Tools
→ Settings validation
→ DeclarativeHttpToolManager
→ Tool Registry / Tool Manifest
→ Tool Runtime
→ fetch
→ Journal / Lease / Receipt / Recovery
```

自定义 HTTP Tool 不是绕过 Runtime 的特殊入口。它与内置工具、MCP 工具一样，继续接受 Schema、预算、超时、熔断、持久化和恢复控制。

## Setting 页面

新增：

```text
Setting
└─ AI
   └─ Custom Tools
```

普通用户可以：

- 启用或关闭全部自定义工具；
- 创建、编辑、启用、禁用和删除 HTTP Tool；
- 配置 GET、HEAD、POST、PUT、PATCH、DELETE；
- 配置 URL 路径、Query、Header 和 JSON Body 参数；
- 配置 Bearer Token 或 API Key；
- 配置固定 Header、响应字段路径、超时和响应大小；
- 使用 JSON 输入执行测试调用。

开发者模式额外提供：

- 允许私有网络；
- 显式允许破坏性 DELETE。

## 工具定义

每个配置会生成稳定 Tool 定义：

```text
source: custom.http.<id>
toolset: custom.<id>
name: custom_http_<normalized-id>_<hash>
```

工具名称包含稳定 Hash，避免 `foo-bar` 与 `foo_bar` 等 ID 规范化后发生冲突。

参数配置会转换为严格 Zod Schema，并通过统一 Tool Manifest 暴露给模型和 Tools 页面。

## Runtime 风险映射

| HTTP 方法 | Runtime effect | 重试策略 | 风险 |
|---|---|---|---|
| GET / HEAD | read | safe | low |
| POST / PUT / PATCH | remote_write | reconcile_before_retry | medium |
| DELETE | destructive | manual_only | high |

DELETE 默认不会进入 Agent Tool 集合，必须在开发者模式下显式允许。

远程写请求遇到超时或不确定副作用时，不会盲目自动重试，而会进入既有 Recovery 流程。

## 网络安全

实现的边界包括：

- 仅允许 HTTP / HTTPS；
- 非本机地址必须使用 HTTPS；
- 默认阻止私有、环回和链路本地网络；
- 每次请求前解析 DNS 并检查地址范围；
- 禁止 URL 中嵌入用户名、密码和 Fragment；
- 禁止自动跟随 Redirect；
- 禁止 Host、Cookie、Content-Length、Authorization 等危险自定义 Header；
- Bearer / API Key 由单独 Credential Store 注入；
- 设置文件不保存凭据明文；
- 响应按字节数限制并安全截断；
- Set-Cookie、Authorization 等敏感响应 Header 不进入 Tool Result。

localhost 可使用 HTTP，便于本地 API 开发与测试。

## 凭据

凭据保存于：

```text
custom-http-credentials.json
```

优先使用 Electron `safeStorage` 加密；若当前系统不支持，则使用权限受限的本地文件。

凭据与 Tool ID 绑定。删除 Tool 时，UI 会同步清除对应凭据。

## 响应处理

支持：

- JSON 与文本响应；
- 点路径提取，如 `data.items.0.id`；
- 最大响应字节限制；
- 截断标记；
- HTTP 状态分类：
  - 401 / 403 → PERMISSION_DENIED
  - 404 → NOT_FOUND
  - 409 / 412 → CONFLICT
  - 429 → RATE_LIMITED
  - 5xx → TEMPORARY_FAILURE

返回结构包含：

```text
status
statusText
url
headers
data
extracted
truncated
responseBytes
observedBytes
```

## Tool Manifest 与 Prompt

自定义 HTTP Tool 会进入统一 Tool Manifest：

```text
sourceKind: custom
sourceSummary.custom
customHttp.method
customHttp.url
customHttp.authMode
```

Tools 页面仍可对其使用：

```text
跟随模式
强制启用
强制禁用
```

动态能力上下文会识别 `custom.http.*` 为受控网络或外部平台能力，并继续声明不存在的 Shell、浏览器或工作区外权限。

## IPC

新增：

```text
custom-tools-get-state
custom-tools-get-secret-status
custom-tools-set-secret
custom-tools-clear-secret
custom-tools-test
```

Preload 公开：

```text
getCustomToolState
getCustomToolSecretStatus
setCustomToolSecret
clearCustomToolSecret
testCustomHttpTool
```

测试调用可以携带尚未完成持久化的安全配置预览，避免设置保存的短暂延迟导致测试使用旧配置。

## 测试

新增测试覆盖：

- 设置清洗与限制；
- 参数 Schema；
- URL 路径、Query、Header、JSON Body；
- Bearer Token；
- 只读与写入 Runtime Contract；
- Redirect 阻止；
- 响应截断；
- HTTP 错误分类；
- Tool Manifest 集成；
- IPC Contract；
- Setting UI Contract；
- Electron Preload Smoke Contract。

验证结果：

```text
Oxlint: 0 warnings, 0 errors
Node Tests: 446 passed, 0 failed
Vite Build: passed
Tool Runtime crash recovery E2E: passed
Atomic write crash matrix: passed
```

当前环境仍无法下载 Electron 二进制，因此真实 Electron 窗口测试需由 GitHub Actions 完成。

## 当前边界

第一版暂不支持：

- OAuth 自定义 HTTP Tool；
- multipart/form-data 文件上传；
- 流式 SSE / WebSocket；
- 自动 Redirect；
- 自定义 JavaScript 转换代码；
- 通用私有网络访问；
- 写操作的业务级 reconcile 查询模板。

这些能力应在后续版本中逐项加入，而不是开放一个不受约束的脚本执行入口。
