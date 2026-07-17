# 会话与短期上下文

## 数据文件

会话保存在 Electron 的 `userData` 目录：

```text
conversations.json
```

数据结构：

```js
{
  version: 1,
  currentConversationId: "...",
  conversations: [
    {
      id: "...",
      title: "...",
      createdAt: 0,
      updatedAt: 0,
      messages: [
        {
          id: "...",
          role: "user" | "assistant",
          content: "...",
          status: "complete" | "aborted",
          createdAt: 0
        }
      ]
    }
  ]
}
```

## 短期上下文

每次发送消息时，只取当前会话最近 N 轮完整消息。

规则：

- 当前用户消息总是包含。
- 完整助手回复进入后续上下文。
- 被停止的部分回复可以保存，但不会进入后续上下文。
- 不同会话之间不会共享消息。

## 当前边界

暂未实现：

- Token 精确计数
- 旧消息自动摘要
- 长期记忆
- 向量检索
- 多模态消息
- 工具消息

这些应当建立在当前会话存储和测试基础之上。
