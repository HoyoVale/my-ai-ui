# Safe Core Tools

Xixi 的第一版工具系统只开放确定性、只读和 Agent 内部状态能力。

## Setting 页面

工具配置集中在：

```text
Setting → AI → Tools
```

页面采用逐层展开：

1. 工具总开关和预设；
2. Tool Runtime；
3. 只读工作区；
4. Toolset；
5. 单个工具；
6. 读取与搜索高级上限。

默认预设：

- `chat`：时间、计算、运行状态和 Agent 内部工具，不开放工作区；
- `workspace`：启用全部当前低风险工具；
- `custom`：用户修改 Toolset 或单工具后自动进入。

固定安全边界不会出现在可放宽设置中。敏感文件、符号链接逃逸、写文件、命令执行和任意网络请求始终被拒绝。

## RuntimeContextProvider

每轮模型请求可以自动注入实时运行环境：

- 当前本地日期和时间；
- UTC 时间；
- IANA 时区和 UTC 偏移；
- 区域语言；
- 操作系统和架构；
- 应用和运行时版本；
- 当前 Provider 与模型；
- 授权只读工作区摘要；
- 当前工具预设、数量或名称。

配置位置：

```text
Setting → AI → Context → 运行环境上下文
```

环境快照不会包含用户名、主机名、IP、环境变量或 API Key。涉及精确时间、系统状态、文件内容和计算时，系统提示词要求模型调用工具，不根据训练记忆猜测。

## Tool Runtime

```text
AgentRuntime
→ createAgentToolSession
→ ToolPolicy / enabled tool filter
→ ToolExecutor
→ AI SDK tool()
→ ToolAuditLog
```

可配置：

- 是否启用工具；
- 一次回复的最大工具循环步数，范围 1–12；
- 单个工具默认超时，范围 2–120 秒；
- 是否把工具记录保存在 Assistant 消息中。

`ask_user` 被调用后会结束当前循环，用户可在下一条消息中回答。

每条工具记录包含：

- Tool call ID；
- 工具名称；
- 输入；
- running / complete / error 状态；
- 结构化输出；
- 执行耗时。

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

Toolset 关闭后，其中所有工具都不会发送给模型。单工具开关在 Toolset 之下生效。

## Workspace policy

推荐直接在 Setting 中添加一个或多个只读工作区。目录选择使用 Electron 原生文件夹选择器。

仍兼容环境变量：

```text
XIXI_WORKSPACE_ROOTS=C:\Projects\one;D:\Projects\two
```

Windows 使用分号分隔多个目录；macOS 和 Linux 使用冒号。Setting 中的目录、环境变量目录和“应用启动目录”会合并去重。

可配置上限：

- 文本文件最大大小；
- 单次读取最大行数；
- 目录项目数量；
- 搜索结果数量；
- 搜索递归深度；
- 哈希文件最大大小。

所有文件工具都会执行：

1. 规范化路径；
2. 检查是否位于授权根目录；
3. 使用 `realpath` 检查符号链接逃逸；
4. 拒绝敏感文件和凭据目录；
5. 拒绝二进制文件和超大文本；
6. 应用当前读取、搜索和哈希上限。

默认忽略 `.git`、`node_modules`、`dist`、`build`、缓存和测试输出。默认拒绝 `.env*`、私钥、证书、Git 凭据、`.ssh`、`.aws`、`.azure` 和 `.kube`。

当前工具不会写文件、执行命令、访问网络、读取剪贴板或读取任意环境变量。
