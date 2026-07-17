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
    availableTokens,
    currentInputRatio,
    worstCaseRatio,
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

- `currentInputRatio`：当前输入 Token 占模型上下文上限，作为主进度条
- `worstCaseRatio`：当前输入加最大输出预留占上下文上限
- `availableTokens`：上下文上限减去当前输入后的空间
- `inputUsageRatio`：输入 Token 占扣除输出预留后的可用输入预算
- `usageRatio`：保留的兼容字段，等于 `worstCaseRatio`
- `inputShareRatio`：该组成部分占当前输入 Token
- `budgetShareRatio`：该组成部分占上下文总上限


## 模型级预算

上下文上限与输出预留来自当前选中的模型配置，而不是 Conversation 设置。切换模型后，ContextAssembler 会同步使用该模型的 `contextTokenBudget` 与 `maxOutputTokens`。
