# 长期记忆 v3

## 设计边界

当前阶段采用结构化、可查看、可编辑的手动记忆。

所有记忆都表示跨会话可用的信息。系统不再引入“项目范围”概念，也不会自动提取聊天内容，不使用 Embedding 或向量数据库。

## 数据结构

```js
{
  id: "...",

  title: "开发环境",

  content:
    "用户主要使用 Windows 10 和 PowerShell。",

  description:
    "回答终端命令和本地开发问题时使用。",

  tags: [
    "Windows",
    "PowerShell"
  ],

  priority: 0.8,
  enabled: true,

  sourceConversationId: null,

  createdAt: 0,
  updatedAt: 0,
  lastUsedAt: 0
}
```

### 字段职责

- `title`：用于列表识别，留空时根据正文自动生成。
- `content`：真正作为长期记忆注入模型的正文。
- `description`：说明适用场景，用于搜索和人工管理，不直接注入模型。
- `tags`：自由标签，用于搜索和组织。
- `priority`：相关程度接近时的选择优先级。
- `enabled`：停用后保留数据，但不参与检索。

## 检索规则

1. Setting 中的长期记忆总开关必须启用。
2. 单条记忆必须启用。
3. 优先级必须达到最低阈值。
4. 标题、正文、描述和标签都参与关键词相关性计算。
5. 相关性优先，优先级用于同等相关结果排序。
6. 最终结果不得超过 `maxInjected`。
7. 注入模型时只发送标题和正文，不发送描述、标签等管理元数据。

## 去重

相同标准化正文只保留一条，不再按范围拆分。

再次创建同正文的记忆会更新原记录；编辑后与其他记录重复时会自动合并标签，并保留更高优先级和启用状态。

## 旧数据迁移

旧版 `memories.json` 中的 `category`、`importance` 和 `scope` 会被移除。

- `importance` 迁移为 `priority`。
- `category` 仅在没有描述时转换为迁移说明。
- `scope` 被丢弃，不再影响记忆检索。
- 旧范围模型中正文相同的记录会自动合并。

迁移前会按照来源版本创建备份，例如：

```text
memories.v1.backup.json
memories.v2.backup.json
```

随后以 `version: 3` 写回正式文件。

## 暂缓功能

以下能力暂不开发：

- 候选记忆自动提取
- 自动保存聊天内容
- 敏感信息规则
- 使用频率衰减
- Embedding 与向量检索
