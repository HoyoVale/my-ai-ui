# 统一上下文与短期记忆管理

所有模型请求统一经过：

```text
electron/context/ContextAssembler.js
```

当前组装顺序：

1. 基础系统规则
2. Personality 人格配置
3. 检索到的长期记忆
4. 用户维护的会话摘要
5. 固定到本会话的消息
6. 当前会话最近 N 轮普通消息

## Personality

Personality 定义助手本身：名称、身份、语言、语气、篇幅和补充行为说明。它不保存用户资料，也不替代长期记忆。

## Long-term Memory

长期记忆保存跨会话仍然有效的信息。只有检索到、启用且达到最低优先级的记忆会加入系统上下文。

## Managed Short-term Context

会话数据版本为 `version: 2`。每条消息新增：

```js
{
  includeInContext: true,
  pinnedToContext: false
}
```

每个会话新增：

```js
{
  summary: "",
  contextStartAfterMessageId: null
}
```

功能包括：

- 最近 N 轮裁剪
- 单条消息加入或排除上下文
- 固定消息到当前会话
- 手动会话摘要
- 清除当前短期上下文边界，但保留历史记录
- 上下文检查器与 Token 分项预算

固定消息和会话摘要位于 system context；普通最近消息位于 messages。固定消息不会在最近消息中重复注入。

## 清除上下文

“清除当前上下文”不会删除消息，而是把 `contextStartAfterMessageId` 设置为当时最后一条消息。之后只有边界后的普通消息进入最近对话；固定消息和摘要继续有效。

## Token 预算

`electron/context/tokenEstimator.js` 使用本地近似算法估算：

- 基础提示词
- Personality
- 长期记忆
- 会话摘要
- 固定消息
- 最近对话
- 输出 Token 预留

设置项 `conversation.contextTokenBudget` 控制显示上限。该数字用于预算展示和溢出提醒，不会自动截断内容。实际 Token 用量仍以模型 API 返回为准。

## ContextAssembler 输出

```js
{
  system,
  messages,
  budget: {
    inputTokens,
    outputReserve,
    totalTokens,
    contextTokenBudget,
    remaining,
    overflowTokens,
    sections
  },
  metadata: {
    personality,
    memoryCount,
    messageCount,
    pinnedMessageCount,
    summaryIncluded,
    recentMessageIds,
    pinnedMessageIds,
    contextStartAfterMessageId
  }
}
```

`metadata` 与 `budget` 不发送给真实模型，主要用于上下文检查器、测试和诊断。
