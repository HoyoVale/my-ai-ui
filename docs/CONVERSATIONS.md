# 会话与短期上下文

## 数据文件

会话保存在 Electron 的 `userData` 目录：

```text
conversations.json
```

数据结构：

```js
{
  version: 3,
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
          status: "complete" | "aborted",
          includeInContext: true,
          pinnedToContext: false,
          createdAt: 0
        }
      ]
    }
  ]
}
```

旧版会话会在读取时自动补齐消息级上下文字段，并删除已废弃的会话摘要字段。

## 短期上下文

每次发送消息时，只取当前会话最近 N 轮完整消息。

规则：

- 当前用户消息总是包含。
- 完整助手回复进入后续上下文。
- 被停止的部分回复可以保存，但不会进入后续上下文。
- 不同会话之间不会共享消息。
- 排除的消息保留在历史中，但不进入模型请求。
- 固定消息不受最近 N 轮裁剪影响。
- 清除上下文只移动边界，不删除历史。

## Token 预算

上下文检查器显示本地估算的总 Token、输入与输出预留，并按基础提示词、Personality、长期记忆、固定消息和最近对话拆分。

组成长条表示各部分占当前输入 Token 的比例；顶部长条表示预计总占用占模型上下文上限的比例。

## 当前边界

暂未实现：

- 依据模型 tokenizer 的精确计数
- 超预算后的自动裁剪策略
- 多模态消息
- 工具消息
