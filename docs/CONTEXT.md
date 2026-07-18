# ContextAssembler

`electron/context/ContextAssembler.js` 是 Agent 请求上下文的唯一组装入口。

## 固定顺序

1. 基础系统规则；
2. 实时运行环境；
3. Personality；
4. 长期记忆；
5. 固定到当前会话的消息；
6. 最近 N 轮普通对话。

固定消息进入 system context，普通最近消息进入 messages。固定消息不会在最近消息中重复注入。

## 运行环境上下文

配置位置：

```text
Setting → AI → Context → 运行环境上下文
```

支持三档预设：

- 精简：时间、时区和当前模型；
- 标准：增加 Locale、系统、应用、工作区摘要和工具摘要；
- 详细：增加运行时版本、完整工作区路径和工具名称；
- 自定义：逐项启用或关闭。

工作区和工具还可以单独选择信息粒度。标准模式不会把完整工作区路径自动发送给模型；模型需要时可以调用 `get_workspace_info`。

关闭自动注入后，时间、运行状态和文件工具仍可正常使用。

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

- `currentInputRatio`：当前输入 Token 占模型上下文上限，作为主进度条；
- `worstCaseRatio`：当前输入加最大输出预留占上下文上限；
- `availableTokens`：上下文上限减去当前输入后的空间；
- `inputUsageRatio`：输入 Token 占扣除输出预留后的可用输入预算；
- `usageRatio`：保留的兼容字段，等于 `worstCaseRatio`；
- `inputShareRatio`：该组成部分占当前输入 Token；
- `budgetShareRatio`：该组成部分占上下文总上限。

运行环境会作为单独的 `runtime` 组成项显示。关闭运行环境注入时，该项为 0。

## 模型级预算

上下文上限与输出预留来自当前选中的模型配置，而不是 Conversation 设置。切换模型后，ContextAssembler 会同步使用该模型的 `contextTokenBudget` 与 `maxOutputTokens`。
