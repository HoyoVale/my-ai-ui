# Goal v2 与 Input 命令面板（78）

## Goal v2

Goal 仍然按会话保存，但不再只有一段目标文本。数据结构现在包括：

- `objective`：最终目标；
- `criteria`：最多 12 条 `Done when`；
- `autoContinue`：证据不足且仍有进展时是否自动进入下一执行阶段；
- `lastVerification`：最近一次完成验证摘要；
- `verificationHistory`：最近 12 次验证历史；
- 每条标准的验证类型、状态、说明、证据引用与人工确认状态。

旧版会话文件会在读取时迁移到 Conversation Store v18，旧 Goal 自动获得空的完成标准、默认开启自动继续，并保留原目标和状态。

### 完成验证

完成标准会按内容映射到测试、构建、Lint、类型检查、检查命令、工作区变更或人工确认。标准中用反引号写出的命令（例如 `` `npm run test:e2e` ``）必须有该命令本身的成功记录，不能由无关测试代替。

无法从 Tool Runtime 客观判断的语义或视觉标准不会自动通过，而会显示为“人工确认”。开发者模式可以手动调整验证类型并查看证据引用。

每个执行 Segment 结束时，Verifier 的结果都会回写当前 Goal。只有总计划、运行时副作用、所需变更和全部完成标准同时通过，内部 `completeGoal` 才能把 Goal 标记为完成。Renderer 不能直接提交 `completed` 状态。

### 自动继续与恢复

开启自动继续时沿用 Runtime 的 Segment、无进展和总时长边界。关闭后每次最多运行一个 Segment，未完成工作保存为可恢复 Checkpoint。暂停 Goal 后，新消息不再注入该 Goal；恢复后继续使用同一个会话目标。

## Input `/` 命令面板

`/` 现在使用统一建议注册表，并按精确 ID、前缀、名称和描述排序。内置命令与当前模式可用的 Skills 会显示在同一列表中，支持上下键、Enter/Tab、鼠标选择和 Escape 关闭。

内置命令：

- `/goal`：打开 Goal 编辑页；
- `/model`：打开模型选择；
- `/workspace`：打开工作区选择；
- `/session`：打开会话选择；
- `/skill`：打开常驻 Skill 与自动路由设置；
- `/mcp`：打开 MCP 快速状态；
- `/mode`：打开 Chat/Coding 模式选择；
- `/new`：在当前模式和工作区新建会话；
- `/plan`：打开 Conversation 查看当前计划；
- `/status`：打开 Conversation 查看任务、计划与 Goal 进度；
- `/memory`：打开 Memory；
- `/settings`：打开 Setting。

内置命令直接复用现有页面、窗口和 IPC 操作，不会被当成普通消息发给模型。Skill 建议保持原有的一次性 `/skill-id 任务` 语义。
