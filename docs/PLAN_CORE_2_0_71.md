# Plan Core 2.0（my-ai-ui 71）

## 目标

Plan Core 2.0 将计划拆成两个相互独立的层级：

```text
Root Plan
├─ 用户可见
├─ 表示整个任务的主要阶段
├─ 决定任务能否结束
└─ 由 update_plan 更新

Step Work
├─ 仅供 Agent 执行当前根步骤
├─ 不进入普通 Plan Dock
├─ 不影响整个任务的完成判断
└─ 由 update_step_work 更新
```

## 新计划 Schema

```json
{
  "schemaVersion": 2,
  "revision": 4,
  "rootRevision": 2,
  "rootArchivedCount": 0,
  "rootItems": [
    {
      "id": "implement",
      "title": "实现 Plan Core 2.0",
      "status": "in_progress",
      "reason": ""
    }
  ],
  "subplans": [
    {
      "rootStepId": "implement",
      "revision": 2,
      "archivedCount": 0,
      "updatedAt": 0,
      "items": [
        {
          "id": "schema",
          "title": "升级消息与 Checkpoint Schema",
          "status": "in_progress",
          "reason": ""
        }
      ]
    }
  ]
}
```

`revision` 在根计划或内部子计划变化时增长；`rootRevision` 仅在用户可见的根计划变化时增长。

## 兼容策略

旧格式：

```json
[
  {
    "id": "one",
    "title": "检查代码",
    "status": "in_progress"
  }
]
```

会自动迁移为：

```json
{
  "schemaVersion": 2,
  "rootItems": [
    {
      "id": "one",
      "title": "检查代码",
      "status": "in_progress"
    }
  ],
  "subplans": []
}
```

为了保持旧 UI 和旧调用兼容，Assistant 消息和 Checkpoint 仍保存 `plan` 字段，但它只包含 `rootItems`。新的完整状态保存在 `planState`。

## Runtime 规则

### 根计划

- 未完成时必须且只能有一个 `in_progress` 根步骤；
- 普通工具只有在存在活动根步骤时才能执行；
- `pending` 或 `in_progress` 根步骤仍存在时，任务不能报告完成；
- `blocked` 和 `needs_input` 仍是明确的终态；
- 根步骤结束时，该步骤中尚未完成的内部子项自动标记为 `superseded`。

### 内部子计划

- 只能绑定当前 `in_progress` 根步骤；
- 未完成时必须且只能有一个 `in_progress` 子项；
- 不进入普通用户 Plan Dock；
- 不独立阻止整个 Agent Run 完成；
- 在续跑时通过 Checkpoint Instruction 恢复给模型。

## 持久化

以下位置同时保存 Plan Core 2.0：

- Agent Runtime 内存状态；
- Assistant 消息 `planState`；
- Activity Checkpoint `planState`；
- 中断恢复记录；
- Segment continuation；
- 重新生成与历史消息替换。

Checkpoint 版本升级为 `5`，Conversation Store 版本升级为 `16`。

## UI 边界

本阶段没有重做 Plan Dock。普通 UI 继续只消费 `message.plan`，因此只显示根计划。

内部子计划暂时只存在于：

- Tool Runtime；
- `update_step_work` 返回值；
- Checkpoint；
- Developer 数据与未来 Plan UI 2.0。

## CI Debug

GitHub Actions 在 `conversation-flow.cjs:597` 失败的原因是测试在 Input 懒加载刚完成时立即统计按钮内部 `svg`：

```js
await inputMenuTrigger.locator("svg").count()
```

`count()` 不等待子节点稳定，因此 Windows 与 Linux 都可能得到 `0`。这不是 `+` 菜单功能失效。

测试已改为：

```js
await inputMenuTrigger.waitFor({ state: "visible" });
assert.equal(
  await inputMenuTrigger.getAttribute("aria-label"),
  "会话与模型"
);
```

该断言验证稳定的用户可见控件与可访问性契约，不再依赖图标内部 DOM。
