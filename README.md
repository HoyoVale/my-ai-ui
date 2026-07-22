# Electron Desktop Agent

当前版本已经完成第一阶段基础 Agent 通信：

```text
Input Window
  → Electron IPC
  → AgentRuntime
  → Provider Adapter / 当前模型
  → Response Window 流式显示
```

## 已完成

- Setting → Model 配置页
- DeepSeek、OpenAI、Anthropic、Ollama 与 OpenAI-compatible Provider
- API Key 本地保存与状态显示
- Temperature、最大输出 Tokens、请求超时
- 模型连接测试
- Input 发送消息
- Response 流式显示
- Input 按钮停止生成
- Agent 运行状态广播
- 友好的缺少密钥、鉴权、限流、网络与超时错误

当前已加入：

- 会话持久化
- 当前会话管理
- 最近若干轮短期上下文
- 新建、切换、删除和清空会话
- 中止回复保存策略
- 自动化回归测试
- Goal、Platform Kernel、隔离 Worktree 与有界多 Agent Supervisor
- 主模型与 Worker 模型独立配置
- MCP 与 Custom HTTP Tool

暂未加入：

- 自动提取记忆
- 向量检索
- 多 Agent commit 自动集成与冲突处理
- 独立 Reviewer 完成门与视觉验证

## 安装

```powershell
npm ci
```

当前锁文件已固定安全的 MCP 传递依赖。不要运行 `npm audit fix --force`；需要检查时使用 `npm audit`。

## 启动

终端一：

```powershell
npm run dev
```

终端二：

```powershell
npm run electron
```

## 配置模型

1. 右键桌宠并打开 `Setting`。
2. 进入 `Model`。
3. 选择 Provider，并在其中添加或选择一个模型配置：
   - 显示名称
   - 实际 Model ID
   - 上下文 Token 上限
   - 最大输出 Tokens
   - Temperature 与超时
4. Base URL 与 API Key 由同一 Provider 下的模型共享。
5. 在顶部分别选择“主模型”和“Worker 模型”，并设置 1–4 个 Worker 并发数。
6. 打开 Input 窗口发送消息。

也可以在项目根目录 `.env` 中配置开发环境回退：

```env
DEEPSEEK_API_KEY=your_deepseek_key
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
```

Setting 中保存的密钥优先于 `.env`。

## Provider 与多模型配置

内置 Provider：

```text
DeepSeek            原生 DeepSeek Chat API
OpenAI              OpenAI-compatible Chat Completions
Anthropic           原生 Messages API
Ollama              本地 OpenAI-compatible API
OpenAI-compatible   LM Studio、LiteLLM 与自建网关
```

Provider 保存共享的 Base URL、凭据模式和 API Key；每个 Provider 可以保存多个模型配置。每个模型独立保存 Model ID、上下文 Token 上限、最大输出 Tokens、Temperature 和超时。`activeProvider` 与 `activeModelId` 决定主模型；`runtimeAssignments.worker` 独立决定多 Agent Worker。旧版单模型设置会自动迁移，未配置 Worker 时会安全跟随主模型。

Provider SDK、运行时解析和扩展步骤见 [`docs/MODEL_PROVIDERS.md`](docs/MODEL_PROVIDERS.md)。

## 全局字体与窗口密度

所有窗口共享一个字体族。Conversation、Response、Input、Memory、Setting 和 Pet menu 分别保存字号与密度，密度会同时调整行高和主要留白。旧版 Input/Response 字体字段会自动迁移。

## Agent 目录

```text
electron/agent/
├─ AgentRuntime.js
├─ agentErrors.js
├─ credentialStore.js
└─ modelFactory.js
```

### AgentRuntime

管理：

- 单次运行状态
- 流式请求
- AbortController
- Response 流式事件
- 错误处理
- 连接测试

### credentialStore

API Key 不写入普通 `settings.json`，而是单独写入 Electron `userData` 目录中的 `credentials.json`。

系统安全存储可用时，凭据通过 Electron `safeStorage` 加密。

## IPC

新增主要 API：

```js
window.api.sendAgentMessage(content)
window.api.stopAgent()
window.api.getAgentStatus()
window.api.onAgentStatusChanged(callback)

window.api.getModelCredentialStatus()
window.api.setModelApiKey(apiKey)
window.api.clearModelApiKey()
window.api.testModelConnection(modelSettings)
```

Renderer 不会获得已保存 API Key 的明文。

## 验证

```powershell
npm run lint
npm run build
```

注意：项目必须保留原有桌宠图片：

```text
assets/xixi_png.png
```


## 会话与短期上下文

会话保存在 Electron 用户数据目录：

```text
conversations.json
```

Setting 中新增：

```text
Conversation
```

可以配置：

- 最近上下文轮数：1–50 轮
- 最多保留会话：10–500 个
- 自动使用第一条用户消息生成标题
- 是否保存被中止的部分回复

Conversation 窗口可以：

- 新建、切换和删除会话
- 将单条消息加入或排除上下文
- 将消息固定到当前会话
- 清除当前短期上下文但保留历史记录
- 查看总 Token 与各组成部分的预计占用

每次发送消息时，AgentRuntime 会：

```text
读取当前会话
→ 保存用户消息
→ 组装 Personality、长期记忆、固定消息和最近 N 轮
→ 调用模型
→ 流式显示回复
→ 保存完整助手回复
```

被用户停止的助手回复可以保存，但不会加入下一次模型上下文。

主要目录：

```text
electron/conversation/
├─ ConversationManager.js
├─ ConversationStore.js
├─ contextBuilder.js
├─ conversationSchema.js
└─ index.js
```

## 自动化测试

纯逻辑测试使用 Node.js 22 自带的 `node:test`；完整 Electron 用户路径使用 Playwright。

运行全部测试：

```powershell
npm test
```

监听模式：

```powershell
npm run test:watch
```

生成内置覆盖率报告：

```powershell
npm run test:coverage
```

执行逻辑、Lint 和构建检查：

```powershell
npm run check
```

启动真实隐藏 Electron 窗口并验证 preload / IPC：

```powershell
npm run test:electron
```

本机完整检查：

```powershell
npm run check:full
```

`npm run check` 会依次运行：

```text
Oxlint
→ Node 自动化测试
→ Vite 构建
```

当前测试覆盖：

- ConversationStore 创建、保存、重载和损坏恢复
- ConversationManager 新建、标题生成、裁剪和淘汰
- 短期上下文最近轮次、重置边界与消息排除
- 固定消息、上下文边界与消息排除
- Token 总量与提示词、人格、记忆、固定消息、最近对话分项预算
- 中止回复不进入下一次上下文
- Conversation 设置范围与模型级 Token 上限校验
- Input 空内容一行高度回归
- Response 关闭后下一条回复重新唤出契约
- 主进程与 preload IPC 频道一致性
- 隐藏 BrowserWindow 中的 `window.api` 实际注入
- 菜单、Pet 拖动、Agent、Settings 和 Conversation 关键 IPC 冒烟验证

GitHub Actions：

```text
.github/workflows/ci.yml
```

会在 Windows 和 Ubuntu 上执行：

```powershell
npm ci
npm run check
```

当前自动化测试重点覆盖纯逻辑、持久化和通信契约。真实 Electron 窗口点击、拖动和视觉布局的 Playwright E2E 测试应作为下一层测试继续加入。

## 独立会话窗口

桌宠右键菜单新增“会话记录”，会打开独立的 `/conversation` 窗口：

- 左侧：历史会话、新建、切换、删除
- 右侧：当前会话完整消息
- “继续对话”：打开 Input 窗口
- 会话更新通过 `conversation-changed` IPC 实时同步

## Playwright Electron E2E

安装依赖后运行：

```powershell
npm run test:e2e
```

测试使用 `XIXI_E2E=1` 内置确定性模型，不读取真实 API Key，也不访问 DeepSeek。

覆盖路径：

```text
打开 Input
→ 发送第一条消息
→ 关闭 Response
→ 发送第二条消息
→ 验证 Response 再次显示
→ 打开会话窗口
→ 新建会话
→ 切换回原会话
→ 验证完整消息
```

失败截图保存在：

```text
test-results/
```

## Linux Electron sandbox

GitHub Actions 的 Linux Runner 不会为 npm 安装的 `chrome-sandbox` 配置 root 所有权和 `4755` 权限。

测试环境使用：

```powershell
npm run test:electron:ci
```

它只为测试进程传入：

```text
--no-sandbox
```

正式应用仍保留 Electron sandbox。



## 长期记忆

长期记忆保存在 Electron 用户数据目录：

```text
memories.json
```

当前版本只支持用户手动创建和维护记忆，不会自动分析或保存聊天内容。所有长期记忆都表示跨会话可用的信息，不再区分“全局”或“当前项目”。

Setting 中：

```text
AI → Memory
```

可以配置：

- 是否启用长期记忆
- 每次最多注入 1–20 条
- 最低优先级阈值
- 打开独立记忆管理窗口
- 清空全部记忆

独立 Memory 窗口支持：

- 标题、正文和描述
- 自由标签
- 优先级
- 启用或停用
- 搜索与状态筛选
- 重复正文自动合并

旧版 `category/importance/scope` 数据会自动迁移为：

```text
title / description / tags / priority
```

迁移后自动写回 `memories.json` v3，并保留对应版本的备份文件。

Agent 请求链路：

```text
当前用户消息
→ 搜索标题、正文、描述和标签
→ 过滤已停用或低优先级记忆
→ 按相关性与优先级排序
→ 限制注入数量
→ 只将标题和正文追加到 System Prompt
→ 组合短期会话上下文
→ 调用模型
```

主要目录：

```text
electron/memory/
├─ MemoryManager.js
├─ MemoryStore.js
├─ memoryContextBuilder.js
├─ memorySchema.js
└─ index.js

src/Memory/
├─ Memory.jsx
├─ Memory.css
├─ components/
└─ hooks/
```

详细说明见：

```text
docs/MEMORY.md
```

## Personality 与统一上下文组装

Setting → AI → Personality 现在可以配置：

- 是否启用自定义人格
- 助手名称与身份描述
- 默认语言
- 回复语气
- 回答篇幅
- 补充行为说明

所有模型请求统一经过 `electron/context/ContextAssembler.js`：

```text
基础系统规则
→ Personality
→ 相关长期记忆
→ 固定到本会话的消息
→ 当前会话最近 N 轮
→ 模型请求
```

Personality 只定义助手是谁、如何回答；用户事实仍应保存在长期记忆中，会话内容仍由短期上下文管理。

Conversation 与 Memory 窗口继续采用统一的轻量桌面布局。Conversation 新增上下文检查器，以当前输入占用作为主指标，并辅助显示最大输出预留、最坏情况预算，以及基础提示词、运行环境、Personality、长期记忆、固定消息和最近对话的分项占用。详细说明见 `docs/SHORT_TERM_CONTEXT.md`。

### Conversation / Response 阅读体验

- Conversation 支持会话重命名、用户消息时间、按角色区分的悬停操作与 Markdown/GFM 渲染。
- Conversation 与 Response 共用 Markdown + LaTeX 渲染器，支持 `$...$` 行内公式和 `$$...$$` 块级公式。
- Response 流式气泡支持代码块、表格、公式与独立复制。

## Safe core agent runtime

本版本加入三项 Agent 基础能力：

- [外部资源安全策略](docs/EXTERNAL_RESOURCES.md)
- 每轮请求的实时运行环境注入
- [第一版低风险工具系统](docs/SAFE_TOOLS.md)
- [Tool 与 Skill 开发路线](docs/TOOL_AND_SKILL_DEVELOPMENT_PLAN.md)

工具运行时当前提供时间、计算、运行状态、任务计划、Tool Read 2.0 工作区读取、经用户批准的原子文件写入、MCP 与 Custom HTTP Tool。普通设置通过 `Chat / Coding` 两种工作模式与工作区完成配置；开启 `Setting → General → Developer mode` 后，才显示 Tool Runtime、Toolset、单工具 description、三态覆盖、安全诊断和恢复信息。Conversation 使用轻量工具活动卡片、Approval 卡片和持久化计划展示工具过程；运行环境注入位于 `Setting → AI → Context`。任意 Shell 与未授权外部写入仍保持关闭。

### Tool Runtime 1.2

当前工具运行时进一步支持：

- Conversation 实时工具活动与计划状态；
- 长任务达到内部边界后生成阶段总结，用户明确继续时继承原任务；
- 大型工具结果自动保存并通过 `read_tool_result` 分页读取；
- 标准化 Agent 停止原因；
- Setting 设置项不再显示标题下方的重复说明文字，开发者工具 description 保留。
