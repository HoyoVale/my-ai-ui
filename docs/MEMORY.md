# 长期记忆

## 设计边界

当前阶段采用结构化、可查看、可编辑的手动记忆。

不会自动提取聊天内容，不使用 Embedding 或向量数据库。

## 数据结构

```js
{
  id: "...",
  category: "profile" | "preference" | "project" | "constraint" | "other",
  content: "...",
  importance: 0.0,
  enabled: true,
  sourceConversationId: null,
  createdAt: 0,
  updatedAt: 0,
  lastUsedAt: 0
}
```

## 检索规则

1. Setting 中的长期记忆总开关必须启用。
2. 单条记忆必须启用。
3. 重要度必须达到最低阈值。
4. 关键词相关性优先于单纯的重要度。
5. 最终结果不得超过 `maxInjected`。
6. 记忆以受控说明追加到 System Prompt。

## 去重

相同类别、相同标准化内容只保留一条。再次创建会更新原记忆；编辑后与其他记忆重复时会自动合并。

## 后续阶段

- 候选记忆自动提取
- 保存前人工确认
- 敏感信息规则
- 使用频率与衰减
- Embedding 与向量检索
