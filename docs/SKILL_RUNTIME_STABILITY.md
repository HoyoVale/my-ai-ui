# Skill Runtime 稳定化审查

> 基线：`my-ai-ui(65)`  
> 范围：现有声明式 Skill Runtime；不包含自动路由、Skill 组合、依赖、远程安装、Marketplace 或可执行脚本。

## 1. 权威状态

Skill 以 Conversation 为绑定单位。一次 Agent Run 的权威执行上下文由以下快照共同确定：

```text
conversation mode / workspace / model
+ skillId / skillSnapshot
+ settings snapshot
= immutable run context
```

续跑、重新生成和恢复任务必须先恢复执行上下文，再解析 Skill。禁止使用当前会话 Skill 与历史 Checkpoint Skill 混合运行。

## 2. Skill 快照

Conversation 与 Checkpoint 保存：

- ID、名称、版本和说明；
- 适用模式；
- 必需与可选 Capability；
- 权限声明；
- Manifest、Prompt 与 Package Hash。

旧会话没有 Hash 时仍可兼容运行；新任务拥有完整 Hash 后，Skill 内容或版本发生变化会返回 `skill-snapshot-mismatch`，不会用新 Skill 静默继续旧任务。

## 3. Tool 与权限

Skill 只声明 Capability，Runtime 解析实际 Tool。必需能力缺失时，模型调用前失败。

能力过滤开启后仍可保留两个受控的 Agent 支持能力：

- `agent.plan` → `update_plan`
- `agent.result.page` → `read_tool_result`

它们仍然受到当前模式、Tool 开关和 `agentInternal` 权限约束，不构成权限扩大。

## 4. 输入与会话一致性

Input 菜单中的模式、工作区和 Skill 使用同一套“目标会话草稿”：

- 修改目标模式不会立即修改当前会话；
- Skill 按目标模式筛选；
- 创建新会话时一次性提交 mode、workspace 和 skillId；
- 当前绑定 Skill 不可用时显示警告，并允许清除绑定；
- Agent 运行期间仍禁止切换 Skill。

## 5. Registry 与状态同步

- Registry 先原子保存，再广播；广播失败只记录警告，不回滚已保存状态。
- 读取 Registry 时按 Skill ID 去重，保留更新时间较新的合法记录。
- Registry State 包含进程内单调 Revision。
- Setting 和 Input 的异步刷新使用请求序列，旧响应不能覆盖新状态。
- Registry 变化时清除旧 Runtime 检查报告。
- 完整性异常的已启用 Skill 可以被禁用或卸载，但不能重新启用。

## 6. Prompt 与 Manifest 边界

- `SKILL.md` 最大 64 KB。
- 大型参考资料应放入 `resources`，当前 Runtime不会自动注入这些文件。
- `modes` 不允许重复或未知值。
- Skill Manifest 的未知 Capability、权限字段和权限值继续严格拒绝。

## 7. UI

Setting → Skills 保持三层信息：

1. 默认可见：名称、说明、模式、可运行状态、启停和兼容性检查。
2. 折叠信息：Capability 与权限。
3. Developer mode：路径、来源、Hash、包规模和完整性错误。

“兼容性检查”只解析当前会话下的 Prompt、Capability、Tool 和权限，不执行 Skill，不产生文件副作用。

## 8. 暂缓功能

以下功能不属于本次稳定化范围：

- 自动 Skill Router；
- 多 Skill 组合；
- Skill 依赖和自动更新；
- 签名、可信来源和 Marketplace；
- URL 或 Git 仓库远程安装；
- Skill 自带脚本与跨平台沙箱。

在现有 Runtime 通过真实 GUI 与长期运行验证前，不扩展上述功能。
