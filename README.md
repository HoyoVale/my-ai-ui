# Electron Desktop Agent

当前版本已经完成第一阶段基础 Agent 通信：

```text
Input Window
  → Electron IPC
  → AgentRuntime
  → AI SDK / DeepSeek
  → Response Window 流式显示
```

## 已完成

- Setting → Model 配置页
- DeepSeek Provider、Base URL、Model ID
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

暂未加入：

- 会话摘要压缩
- 自动提取记忆
- 向量检索
- 工具调用
- MCP
- 多 Agent

## 安装

```powershell
npm install
```

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
3. 保持或修改：
   - Provider：DeepSeek
   - Base URL：`https://api.deepseek.com`
   - Model ID：`deepseek-chat`
4. 输入 API Key 并点击保存。
5. 点击“测试连接”。
6. 打开 Input 窗口发送消息。

也可以在项目根目录 `.env` 中配置开发环境回退：

```env
DEEPSEEK_API_KEY=your_api_key
```

Setting 中保存的密钥优先于 `.env`。

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

可以执行：

- 新建会话
- 切换当前会话
- 删除单个会话
- 清空全部会话

每次发送消息时，AgentRuntime 会：

```text
读取当前会话
→ 保存用户消息
→ 取最近 N 轮完整消息
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
- 短期上下文最近轮次
- 中止回复不进入下一次上下文
- Conversation 设置范围校验
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
→ 当前会话最近 N 轮
→ 模型请求
```

Personality 只定义助手是谁、如何回答；用户事实仍应保存在长期记忆中，会话内容仍由短期上下文管理。

Conversation 与 Memory 窗口继续采用统一的轻量桌面布局，并增加了时间分组、消息复制、未保存提示、切换前确认和更紧凑的信息层级。
