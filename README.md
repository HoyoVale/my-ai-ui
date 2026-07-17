# Xixi Electron Desktop Agent

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
- 长期记忆
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

项目不新增测试依赖，使用 Node.js 22 自带的 `node:test`。

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
