# 会话与短期上下文

## 数据文件

会话保存在 Electron 的 `userData` 目录：

```text
conversations.json
```

当前数据版本为 `11`。助手消息除正文外，可以保存生成耗时、运行状态、计划与统一活动事件流：

```js
{
  version: 11,
  currentConversationId: "...",
  conversations: [
    {
      id: "...",
      title: "...",
      contextStartAfterMessageId: null,
      createdAt: 0,
      updatedAt: 0,
      messages: [
        {
          id: "...",
          role: "user" | "assistant",
          content: "...",
          status: "running" | "complete" | "aborted" | "interrupted",
          includeInContext: true,
          pinnedToContext: false,
          createdAt: 0,

          // 仅助手消息可选
          durationMs: 1200,
          stopReason: "completed",
          plan: [],
          activity: {
            version: 3,
            taskId: "...",
            runId: "...",
            status: "completed",
            events: []
          }
        }
      ]
    }
  ]
}
```

旧版会话会在读取时迁移。历史结构化问题会转换为普通 `needs_input` 文本，不再保留可交互问题状态；旧的模型推理摘要会被丢弃。

## Conversation 窗口

- 顶栏保留侧栏、上下文、新建、继续对话和窗口控制。
- 侧栏仅显示会话标题。
- 用户消息使用轻量气泡，助手消息采用无气泡阅读布局。
- 助手消息支持 Markdown、GFM 表格、代码块和独立复制。
- 最新助手回复支持重新生成，替换原回复而不重复写入用户消息。
- 助手回复上方可折叠显示公开进度、计划与工具活动；原始模型推理不保存、不展示。

## 短期上下文

每次发送消息时，只取当前会话最近 N 轮完整消息。

- 当前用户消息总是包含。
- 完整助手回复进入后续上下文。
- 被停止的部分回复可以保存，但不会进入后续上下文。
- 不同会话之间不会共享消息。
- 排除的消息保留在历史中，但不进入模型请求。
- 固定消息不受最近 N 轮裁剪影响。
- 重置上下文只移动边界，不删除历史。

## Token 预算

上下文检查器显示本地估算的总 Token、输入与输出预留，并按基础提示词、Personality、长期记忆、固定消息和最近对话拆分。

## 消息操作与会话重命名

- 用户消息上方显示发送时间，底部仅提供复制。
- 助手消息底部提供复制、重新生成、固定到本会话、加入或排除上下文。
- 会话列表支持悬停编辑或双击重命名；Enter 保存，Escape 取消。
