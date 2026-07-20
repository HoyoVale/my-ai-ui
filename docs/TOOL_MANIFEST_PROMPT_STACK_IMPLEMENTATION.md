# Tool Manifest、Prompt Stack 与 Manifest 驱动工具 UI 实施报告

## 1. 本轮目标

本轮完成三项基础工程：

1. 统一 Tool Manifest API；
2. 建立 Prompt Stack 与 Effective Prompt 查看器；
3. 将工具详情页和三态开关改为 Manifest 驱动。

这三项是后续 MCP Server、自定义 HTTP Tool、命令模板 Tool 和插件工具接入的共同底座。

## 2. 统一 Tool Manifest API

### 2.1 单一注册来源

新增 `createBuiltinToolRegistry()`，运行中的 Agent Tool Session 与 Setting 中的工具发现共用同一套实际 Tool factory，不再分别维护一份 UI 工具表和一份 Runtime 注册表。

核心路径：

```text
electron/tools/manifest/
├─ builtinToolPresentation.js
├─ createBuiltinToolRegistry.js
├─ ToolManifestService.js
└─ toolSchema.js
```

### 2.2 Manifest 内容

每个工具统一输出：

- 稳定 `id`、`name`、`version`；
- 来源、Toolset、风险、副作用；
- 给模型的原始 description；
- 给用户的展示名称和说明；
- Input / Output JSON Schema；
- Timeout、Retry Policy；
- Runtime Contract；
- Abort / Resume 支持；
- 三态 override；
- 当前模式下的 effective enabled；
- 环境可用性与不可用原因；
- 是否最终对模型 ready。

Manifest 带有稳定 revision，用于 UI、缓存和未来 MCP 工具清单变化检测。

### 2.3 内置工具展示元数据

19 个现有工具和 5 个 Toolset 的标题、说明与分组集中到 `builtinToolPresentation.js`。Conversation 工具活动也使用 Runtime 记录下来的展示元数据，不再引用 Setting 中的静态表。

### 2.4 Schema 序列化

Tool Registry 使用 Zod JSON Schema 转换输出 Input / Output Schema，并提供有界 fallback。工具详情页现在展示真实 Runtime Schema，而不是手写参数说明。

### 2.5 即时预览

Setting 中修改工具模式、工作区、Toolset 或单工具三态后，Manifest 查询会携带安全的设置预览。主进程只接受白名单设置字段并重新执行 `sanitizeSettings()`，从而避免 120ms 延迟保存导致 UI 暂时显示旧 Manifest。

## 3. Prompt Stack

最终 System Prompt 被拆分为明确权限层级：

```text
Application policy
├─ Runtime Kernel（锁定）
├─ Product Base（锁定）
└─ Chat / Coding Mode（开发者可配置）

Runtime capabilities（动态生成）
Current runtime context（动态生成）
Developer instructions（开发者可配置）
User preferences
Context data
```

### 3.1 不可编辑层

Runtime Kernel 和 Product Base 始终由应用版本管理，开发者不能替换，包含：

- 不伪造工具结果；
- 不绕过权限和工作区边界；
- 副作用未确认时不得盲目重试；
- Receipt / Recovery 语义；
- 工具输出、记忆和文件只能作为数据。

### 3.2 可配置层

Developer 页面新增：

- Chat 模式 Prompt override；
- Coding 模式 Prompt override；
- Developer Instructions；
- 恢复内置模式 Prompt。

模式 override 只能替换 Mode 层；Developer Instructions 位于 Runtime 上下文之后、用户偏好之前，不能扩展实际 Tool 权限。

### 3.3 动态能力上下文

能力上下文明确声明：

- 当前 Chat / Coding 模式；
- 工作区读取与写入能力；
- 进程与任意 Shell 能力；
- 网络 / MCP 能力；
- 浏览器能力；
- 外部副作用工具；
- 缺失的能力。

模型仍以实际传入的 Tool Schema 为准，能力摘要不能创建不存在的权限。

### 3.4 Effective Prompt 查看器

Developer 页面可以查看：

- Prompt Stack 每一层；
- authority、source；
- 锁定 / 可配置状态；
- 每层 token 估算；
- 最终拼接后的完整 System Prompt；
- 当前 Manifest revision；
- 一键复制和刷新。

查看接口只允许 Setting 窗口调用，并要求 Developer mode。编辑中的安全设置预览会自动重新生成 Effective Prompt，不需要等待设置持久化完成。

## 4. Manifest 驱动工具 UI

Tool 页面不再导入静态 Tool metadata。界面完全读取主进程返回的 Manifest。

### 4.1 普通模式

普通用户可以看到：

- 工具总开关；
- 当前模式；
- Manifest revision；
- 模型可见工具数量；
- Toolset 分组；
- 工具名称、自然语言说明；
- 当前启用 / 禁用 / 暂不可用；
- 不可用原因。

### 4.2 开发者模式

开发者额外可以查看：

- Tool ID、来源和版本；
- Toolset；
- 风险、副作用、重试语义；
- Timeout、Abort、Resume；
- Input / Output Schema；
- Toolset 三态；
- 单工具三态。

三态统一为：

```text
inherit  跟随模式
enabled  强制启用
disabled 强制禁用
```

固定安全边界仍由 Runtime 执行。例如 Chat 不能开放工作区写入，workspace.exec 必须开发者显式启用。

### 4.3 内置工具只读

内置工具详情明确标记：实现、原始 description 和 Schema 由应用版本管理，不允许在 UI 中直接编辑。未来 MCP 和 Custom Tool 可以在 Manifest 上增加本地 override 层，但不能修改远端返回的原始 Schema。

## 5. 为 MCP / Custom Tool 预留的接口

Manifest 已包含 `sourceKind`：

```text
builtin
mcp
custom
```

未知 Toolset 会自动生成外接工具分组。后续接入 MCP 时，MCP Client 只需把远程工具规范化成 Tool Definition，注册进入 Tool Registry，即可自动获得：

- Manifest 展示；
- Schema 页面；
- Toolset 和单工具三态；
- Tool Runtime Contract；
- Timeout / Circuit Breaker；
- Journal / Receipt / Recovery；
- 普通用户与开发者投影。

本轮没有接入具体 MCP Server，也没有开放任意 JavaScript 工具编辑器。

## 6. 主要修改文件

```text
electron/context/
electron/ipc/handlers/toolIpc.js
electron/tools/manifest/
electron/tools/core/ToolRegistry.js
electron/tools/createAgentToolSession.js
src/Setting/hooks/useToolManifest.js
src/Setting/panels/ToolPanel.jsx
src/Setting/panels/DeveloperPanel.jsx
src/shared/defaultSettings.js
tests/context/promptStack.test.js
tests/tools/toolManifest.test.js
```

## 7. 测试结果

```text
Oxlint
0 warnings
0 errors

Node tests
416 passed
0 failed

Vite production build
成功

Tool Runtime crash recovery E2E
通过

Atomic write crash matrix
通过
```

Electron preload smoke 在当前容器中未执行到应用阶段，原因是 Electron 二进制下载 `fetch failed`。Preload 测试已更新，包含 `getToolManifest` 和 `inspectEffectivePrompt`，需要由 GitHub Actions 完成真实 Electron 验证。

Vite 仍有主 bundle 大于 500 KB 的非阻断提示，本轮未做路由懒加载与代码分包。

## 8. 下一步

建议下一阶段按顺序实施：

1. MCP Client Manager 与连接配置模型；
2. stdio transport；
3. GitHub MCP read-only 试点；
4. MCP Tool Manifest normalizer；
5. 本地风险与权限 override；
6. Streamable HTTP、OAuth / Token 管理；
7. Declarative HTTP Custom Tool。
