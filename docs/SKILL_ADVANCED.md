# Skill Advanced

> 实施版本：my-ai-ui 66  
> 范围：`/skill-id` 临时调用、保守自动路由、多 Skill 组合、声明式依赖  
> 不包含：远程安装、Marketplace、自动更新、可执行脚本或脚本沙箱

## 一、设计目标

Skill Advanced 只扩展“如何选择和组合声明式 Skill”，不改变现有安全边界：

```text
Skill 选择或组合
→ Skill 依赖解析
→ Prompt Stack
→ Capability Resolver
→ Tool / MCP / Custom HTTP
→ Tool Security / Approval
```

Skill 仍不能直接执行代码，也不能提高 Tool、MCP、工作区或用户设置已经拒绝的权限。

## 二、`/skill-id` 一次性调用

用户可以在消息开头临时选择 Skill：

```text
/debug 检查当前报错
```

也可以连续选择多个 Skill：

```text
/review /fix 检查并修复这个问题
```

规则：

- 只解析消息开头、已安装且当前可运行的 Skill ID；
- 一次最多组合 4 个命令；
- 命令后必须有任务正文；
- 命令前缀不会进入最终用户消息和模型上下文；
- 只对本次任务生效，不改写会话的长期 Skill 绑定；
- 续跑、恢复和重新生成沿用原任务 Skill 快照；
- 未识别的 `/...` 保持普通文本，避免抢占其他命令体系。

## 三、自动 Skill Router

会话可以选择“自动选择”。Router 完全在本地运行，不额外调用模型，也不会读取网络内容。

匹配信号：

- `skill.json` 中的 `keywords`；
- Skill ID 和名称；
- description 中的有限词项；
- 当前 Chat/Coding 模式。

Router 采用保守阈值：

- 只自动选择一个根 Skill；
- 分数不足或候选接近时不选择；
- 没有可靠结果时继续使用默认 Tool Runtime；
- 结果会写入本次 Assistant 消息的 Skill 活动记录；
- 自动路由结果在任务续跑和恢复时被冻结，不会中途重新选择。

这不是智能分类模型。它的目标是可解释、稳定和低误触发。

## 四、多 Skill 组合

会话可以显式绑定最多 4 个根 Skill。运行时会：

1. 解析所有依赖；
2. 按拓扑顺序先加载依赖；
3. 再按用户选择顺序加载根 Skill；
4. 合并必需和可选 Capability；
5. 对所有权限做最严格交集；
6. 将组合后的 Prompt 作为一个 Skill Prompt Stack 注入。

组合限制：

```text
根 Skill：最多 4 个
根 Skill + 依赖：最多 12 个
组合 Prompt：最多 128 KB
```

权限交集示例：

```text
Skill A：localWrite = allow
Skill B：localWrite = ask
最终：localWrite = ask
```

任意 Skill 为 `deny` 时，最终权限为 `deny`。组合只能扩大工作流程和 Capability 请求，不能扩大权限。

当 Skill 指令出现冲突时，后选择的根 Skill 在同一 Skill authority 层中优先，但仍必须服从应用策略、开发者指令、Capability、Tool Security 和用户最新请求。

## 五、Skill 依赖

`skill.json` 可以声明：

```json
{
  "dependencies": [
    {
      "id": "shared-analysis",
      "version": "^1.2.0",
      "optional": false
    }
  ]
}
```

支持的版本范围：

```text
*
latest
1.2.3
^1.2.3
~1.2.3
>=1.2.3
<=1.2.3
>1.2.3
<1.2.3
1.x
1.2.x
```

依赖解析会检查：

- 是否已安装；
- 是否启用；
- 完整性是否通过；
- Chat/Coding 模式是否兼容；
- 版本是否满足；
- 是否存在循环依赖；
- 总依赖图是否超过上限。

可选依赖缺失、禁用、版本不符或模式不兼容时会跳过；必需依赖出现这些问题时，根 Skill 不可运行。

依赖保护：

- 被已启用 Skill 必需依赖的 Skill 不能直接禁用或卸载；
- 安装导致循环依赖时，安装事务会在写入 Registry 前失败；
- 缺失依赖允许先安装根 Skill，但它会显示为“已阻止”，直到依赖补齐；
- 更新依赖后，所有 Skill 会重新计算可用状态。

依赖只引用已安装的声明式 Skill，不自动下载、不执行安装命令，也不运行脚本。

## 六、会话、续跑和恢复一致性

Conversation 同时保存：

- 旧版兼容字段 `skillId` / `skillSnapshot`；
- 根 Skill 列表 `skillIds`；
- 根 Skill 与依赖的完整快照 `skillSnapshots`；
- `manual` 或 `auto` 路由模式。

每次 Agent Run 和 Checkpoint 还保存：

- Skill 来源：manual、command、router 或 none；
- Router 选择证据；
- 根 Skill 与依赖快照；
- Capability 与权限结果。

因此：

- `/skill-id` 任务续跑时仍使用临时 Skill；
- Router 任务恢复时不重新路由；
- 重新生成优先使用原 Assistant 消息的 Skill 快照；
- Skill 包在任务后被更新时，旧任务拒绝静默续跑并返回快照不一致错误。

## 七、UI

### Input

Skill 页面支持：

- 自动选择；
- 不使用 Skill；
- 多选最多 4 个根 Skill；
- 明确点击“应用到当前会话”或“用于新会话”；
- 显示 `/skill-id` 临时调用提示；
- 显示绑定已禁用、卸载、损坏或更新后的异常。

### Conversation

顶栏显示：

- Auto Skill；
- 单个 Skill 名称；
- 多 Skill 组合数量。

每条 Assistant 任务活动记录显示实际 Skill 来源、组合、依赖、Capability 与最终工具映射。

### Setting → Skills

Skill 卡片显示：

- 依赖数量与依赖异常；
- 依赖 ID、版本范围和必需/可选；
- 自动路由关键词；
- 当前可运行、已禁用、完整性异常或依赖阻断状态。

## 八、安全边界

Skill Advanced 不会：

- 自动安装依赖；
- 从网络下载 Skill；
- 执行 Skill 包中的脚本；
- 绕过 Approval；
- 绕过 MCP 权限；
- 绕过工作区路径边界；
- 将自动路由结果当作高可信指令。

当前 Skill 仍然是“声明式工作流 + Capability 请求”，而不是代码插件。

## 九、后续暂缓

以下能力不属于本阶段：

- 远程 URL 或 Git 仓库安装；
- 自动更新与更新回滚；
- 作者签名和可信来源；
- Marketplace；
- 多 Skill 冲突声明协议；
- 模型驱动的高级 Router；
- Skill 内脚本和跨平台沙箱。
