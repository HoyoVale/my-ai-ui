# ContextAssembler

`electron/context/ContextAssembler.js` 是 Agent 请求上下文的唯一组装入口。

## 固定顺序

1. 基础系统规则
2. Personality
3. 长期记忆
4. 固定到当前会话的消息
5. 最近 N 轮普通对话

固定消息进入 system context，普通最近消息进入 messages。固定消息不会在最近消息中重复注入。

## 会话结构

```js
{
  id: "...",
  title: "...",
  contextStartAfterMessageId: null,
  messages: [
    {
      id: "...",
      role: "user",
      content: "...",
      status: "complete",
      includeInContext: true,
      pinnedToContext: false
    }
  ]
}
```

## Token 预算

`ContextAssembler` 同时返回预算诊断：

```js
{
  budget: {
    totalTokens,
    inputTokens,
    outputReserve,
    contextTokenBudget,
    remaining,
    usageRatio,
    inputUsageRatio,
    sections: [
      {
        id,
        label,
        tokens,
        inputShareRatio,
        budgetShareRatio
      }
    ]
  }
}
```

- `usageRatio`：预计总占用占上下文上限
- `inputUsageRatio`：输入 Token 占可用输入预算
- `inputShareRatio`：该组成部分占当前输入 Token
- `budgetShareRatio`：该组成部分占上下文总上限
