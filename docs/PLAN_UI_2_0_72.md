# Plan UI 2.0（my-ai-ui 72）

## 目标

Plan Core 2.0 已经把面向用户的根计划与模型内部子计划分离。本阶段只处理展示层：

- Plan Dock 只展示根计划；
- 根步骤具有清晰、稳定的状态动画；
- 根计划发生修订时显示“计划已调整”；
- 开发者模式可检查内部子计划；
- 历史 Assistant 消息优先从 `planState` 恢复层级计划。

## Plan Dock

底部 Plan Dock 改为单列执行轨迹：

```text
执行计划                         2 / 4
当前：修复 Conversation 状态同步

✓ 检查项目结构             已完成
● 修复状态一致性           进行中
○ 增加回归测试             待执行
○ 完成验证                 待执行
```

Dock 仅渲染：

```js
snapshot.planState.rootItems
```

不会读取或展开 `subplans`。

新任务出现计划时默认展开；用户可以手动收起。根计划修订时 Dock 会重新展开，避免用户错过范围变化。

## 计划调整提示

活动事件会保存根计划修订信息：

```js
{
  type: "plan",
  revision: 5,
  rootRevision: 2,
  scope: "root",
  reason: "发现需要先处理 Renderer 状态同步。"
}
```

当满足以下任一条件时，UI 标记计划已经调整：

- `planState.rootRevision > 1`；
- 活动中存在多个根计划事件；
- 最新根计划事件的 `rootRevision > 1`。

Dock 和历史活动面板会显示“计划已调整”。存在 `reason` 时同时展示调整原因；没有原因时使用中性说明，不推测模型意图。

## 根步骤状态

根步骤支持：

- `pending`
- `in_progress`
- `completed`
- `blocked`
- `needs_input`
- `skipped`
- `cancelled`
- `superseded`

视觉规则：

- `in_progress`：强调当前行、脉冲圆点；
- `completed`：检查标记和降低视觉权重；
- `blocked` / `needs_input`：危险色提示；
- `skipped` / `cancelled` / `superseded`：中性终止标记；
- 所有动画遵守 Reduced Motion 设置。

## 开发者内部子计划

普通 Plan Dock 和普通活动计划区域不会显示内部子计划。

开发者活动面板增加“内部子计划”检查器：

```text
内部子计划
└─ 修复状态一致性                 2/3 · revision 3
   ✓ 修改主进程状态来源
   ● 修改 Renderer 聚合
   ○ 增加窗口回归测试
```

每个子计划绑定 `rootStepId`，并显示：

- 对应根步骤；
- 子计划 Revision；
- 已完成数 / 总数；
- 子步骤状态和原因。

内部子计划明确标注“不计入用户总计划进度”。

## 历史恢复

历史计划恢复优先级：

```text
message.planState.rootItems
→ activity.checkpoint.planState.rootItems
→ 最新 plan 活动事件
→ message.plan 兼容投影
```

因此即使 `message.plan` 是旧投影或活动事件被裁剪，Conversation 仍可从版本化 `planState` 还原根计划和内部子计划。

旧版只有 `message.plan` 的消息继续正常显示，并自动得到一个无子计划的视图状态。

## 数据边界

- 根计划进入普通 Conversation 状态和 UI；
- 内部子计划仅在历史消息本地数据或按需加载的开发者运行详情中展示；
- Plan Dock 永远不渲染 `subplans`；
- 子计划仍不参与任务整体完成比例。

## 验证

覆盖以下回归：

- 历史消息优先使用 `planState.rootItems`；
- 旧 `message.plan` 不会覆盖新 Plan State；
- 内部子计划可按根步骤恢复；
- Plan Dock 不引用 `subplans`；
- 多次根计划修订显示“计划已调整”；
- `rootRevision` 与 `scope` 通过活动 Schema 持久化；
- Reduced Motion 关闭全部 Plan UI 动画。
