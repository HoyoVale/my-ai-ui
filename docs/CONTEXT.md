# 统一上下文系统

模型请求不再由 `AgentRuntime` 临时拼接字符串，而是统一经过：

```text
electron/context/ContextAssembler.js
```

组装顺序：

1. 基础系统规则
2. Personality 人格配置
3. 检索到的长期记忆
4. 当前会话最近 N 轮消息

## Personality

Personality 定义助手本身：

- `name`
- `identity`
- `language`
- `tone`
- `responseLength`
- `customInstructions`

Personality 不保存用户资料，也不替代长期记忆。

## Long-term Memory

长期记忆只保存跨会话仍然有效的用户事实、偏好和稳定约束。只有检索到且启用的记忆会加入系统上下文。

## Short-term Context

短期上下文来自当前会话最近 N 轮完整消息。不同会话之间不会共享短期消息。

## ContextAssembler 输出

```js
{
  system,
  messages,
  metadata: {
    personality,
    memoryCount,
    messageCount,
    contextTurns
  }
}
```

`metadata` 不发送给真实模型，主要用于测试、诊断和后续上下文检查器。
