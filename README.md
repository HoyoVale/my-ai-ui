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

当前每条消息是独立请求，暂未加入：

- 会话持久化
- 上下文历史
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
