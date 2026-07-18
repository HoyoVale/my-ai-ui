# Safe Core Tools 与 Tool UX 1.1

Xixi 当前工具系统只开放确定性、Agent 内部状态和授权工作区只读能力。普通用户通过简洁的工作模式使用工具；开发者模式提供完整描述、覆盖选项和诊断信息。

## 普通设置

位置：

```text
Setting → AI → Tools
```

普通模式只显示三类设置：

1. Chat / Coding 工作模式；
2. Coding 授权工作区；
3. 工具调用的简洁 / 详细显示。

### Chat

启用：

- 时间与时区；
- 日期计算；
- 安全计算器；
- 运行环境与 Agent 状态；
- 任务计划；
- 结构化向用户提问。

Chat 不向模型暴露工作区文件工具。

### Coding

包含 Chat 的全部能力，并增加授权工作区只读工具：

- 查看目录与路径信息；
- 分段读取文本文件；
- 搜索文件和文本；
- 识别项目类型；
- 计算文件哈希。

只有至少一个有效授权工作区时，文件工具才具有可操作目标。

## 开发者模式

位置：

```text
Setting → General → Developer mode
```

开发者模式只增加高级 UI 与诊断信息，不解除固定安全边界，也不会自动启用更多工具。

开启后，Tools 页面额外显示：

- Agent 最大步骤、工具调用总数、运行总超时、单工具超时和重复调用限制；
- Toolset 三态覆盖：跟随模式、强制启用、强制禁用；
- 单工具三态覆盖；
- 每个工具的中文名称、内部 ID 和 description；
- 当前模型与本轮可见工具数量；
- 工作区读取和搜索的高级限制。

Setting 侧栏还会出现 Developer 页面，用于查看 Tool Runtime、模型和安全边界摘要。

## Toolsets

### `core.runtime`

- `get_current_time`
- `convert_time_zone`
- `calculate_date`
- `calculator`
- `get_runtime_info`
- `get_agent_status`

### `workspace.read`

- `get_workspace_info`
- `list_directory`
- `stat_path`
- `read_text_file`
- `search_files`
- `search_text`
- `detect_project`
- `compute_file_hash`

### `agent.internal`

- `update_plan`
- `ask_user`

普通模式由 Chat / Coding 自动决定 Toolset。开发者覆盖仅在显式设置时生效，默认全部为 `inherit`。

## Tool Runtime

```text
AgentRuntime
→ createAgentToolSession
→ resolve enabled tools
→ ToolExecutor
→ AI SDK tool()
→ ToolAuditLog
```

当前运行保护包括：

- 最大 Agent 步数；
- 最大工具调用总数；
- Agent Run 总超时；
- 单工具超时；
- 相同工具与参数的重复调用限制；
- `ask_user` 触发后停止本轮工具循环；
- 标准化成功、失败和停止原因；
- 可选的 Conversation 工具历史持久化。

`update_plan` 生成的计划会随 Assistant 消息保存，Conversation 可以展示任务进度。

## Conversation 中的工具活动

普通显示采用轻量活动卡片：

```text
正在搜索项目文件…
✓ 已找到相关文件
```

完成后收拢为：

```text
已使用 3 个工具
```

简洁模式只显示自然语言状态。详细模式增加目标路径、范围和耗时。开发者模式展开后才显示内部工具名称、输入、输出和原始数据。

## Workspace policy

推荐在 Tools 页面使用 Electron 原生目录选择器添加一个或多个只读工作区。仍兼容：

```text
XIXI_WORKSPACE_ROOT=C:\Projects\one
XIXI_WORKSPACE_ROOTS=C:\Projects\one;D:\Projects\two
```

所有文件工具都会：

1. 规范化路径；
2. 检查授权根目录；
3. 使用 `realpath` 阻止符号链接逃逸；
4. 拒绝敏感文件和凭据目录；
5. 拒绝二进制文件和超大文本；
6. 应用读取、搜索和哈希上限。

默认忽略 `.git`、`node_modules`、`dist`、`build`、缓存和测试输出。默认拒绝 `.env*`、私钥、证书、Git 凭据、`.ssh`、`.aws`、`.azure` 和 `.kube`。

## 固定安全边界

无论普通模式还是开发者模式，当前版本都不会：

- 写入或删除文件；
- 执行 Shell 或任意代码；
- 发起任意网络请求；
- 读取敏感凭据；
- 逃逸授权工作区；
- 解除外部资源安全策略。
