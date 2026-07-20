# Safe Tools、Tool Runtime 与安全边界

Xixi 的工具能力由两层共同决定：

1. 模型只会看到当前会话实际启用的工具名称、description 和输入 Schema；
2. 主进程 Tool Runtime 再执行权限、工作区、预算、超时、幂等、收据和恢复校验。

模型提出调用并不等于调用一定会执行。Tool Runtime 始终是最终安全边界。

## 普通模式

### Chat

默认提供：

- 当前时间、时区和日期计算；
- 受限计算器；
- 净化后的运行环境与 Agent 状态；
- 任务计划和大型结果分页读取。

当会话绑定了工作区时，可以查看工作区授权和安全限制，但 Chat 不开放文件写入。

### Coding

在 Chat 能力上增加：

- 确定性目录浏览；
- 路径信息；
- 分段文本读取；
- 文件与文本搜索；
- 项目清单识别；
- 流式 SHA-256；
- 原子文本写入。

没有用户明确授权的工作区时，不注册工作区工具。

## Toolsets

- `core.runtime`：时间、日期、计算器、运行环境、Agent 精简状态；
- `workspace.read`：工作区信息、目录、文件读取、搜索、项目识别和哈希；
- `workspace.write`：原子文本写入；
- `workspace.exec`：受控 Git 检查和显式允许的进程命令；
- `agent.internal`：计划维护和大型工具结果分页。

## 工作区读取边界

所有读取工具都会：

- 规范化路径并校验授权根目录；
- 使用真实路径阻止符号链接逃逸；
- 直接拒绝 `.git`、`node_modules`、`dist`、`build`、缓存与测试输出目录；
- 拒绝 `.env*`、私钥、证书、Git 凭据、`.ssh`、`.aws`、`.azure` 和 `.kube`；
- 拒绝二进制和超限文件；
- 对目录、文件数、扫描字节、搜索结果和递归深度设置上限；
- 支持 AbortSignal，并以确定性顺序返回结果。

## 原子写入

`write_text_file` 仅在 Coding 模式和授权工作区内可用。写入流程为：

```text
临时文件 → fsync → 原子替换 → 目录同步 → SHA-256 复核 → Receipt
```

同时支持：

- 敏感与排除路径拦截；
- 符号链接防护；
- `expectedSha256` 乐观并发控制；
- 相同内容幂等重放；
- 崩溃后的临时文件与 Receipt 恢复。

## 进程工具

`workspace.exec` 默认关闭，只有开发者显式强制启用后才会向模型公开。

### `git_inspect`

只允许保守的 Git 查看操作。Runtime 会拦截：

- 分支创建、删除、移动和强制修改；
- `--output` 等文件输出参数；
- external diff、textconv 和 `--no-index`；
- 工作区外 pathspec；
- Shell 展开和交互式凭据提示。

### `run_workspace_command`

没有内置的默认命令白名单。只有开发者在 `allowedCommands` 中明确配置的命令才可运行。命令与参数以数组形式直接传给进程，不经过 Shell，并由 `SubprocessSupervisor` 提供超时、取消、输出上限和进程树终止。

它不是容器或操作系统沙箱。被允许的程序仍拥有当前应用进程账户的系统权限，因此只应加入可信命令。

## Tool Runtime 保护

当前运行保护包括：

- Tool Registry 名称、Schema 和元数据校验；
- Toolset 和单工具开关；
- Run、Step、Batch 和重复调用预算；
- Abort、Timeout、并发键与受控重试；
- Provider/Tool 熔断器；
- Journal、Lease、Receipt 和 Checkpoint；
- 不确定写操作核验与人工 Recovery Center；
- 大结果引用、分页和磁盘配额；
- 增量 IPC 和普通/开发者数据投影；
- 子进程树监督和崩溃恢复测试。

`update_plan` 的历史会被有界保留，防止长期反复改计划导致状态无限增长。`read_tool_result` 在计划已结束后仍可使用，以便模型读取最终所需的大结果。

## 普通用户与开发者信息

普通用户可见：

- 自然语言工具名称；
- 当前进度、成功、失败和恢复提醒；
- 计划和目标文件；
- 必要的确认操作。

开发者模式额外可见：

- 内部工具名称与 Toolset；
- 输入/输出与调用耗时；
- Tool Contract、重试和恢复能力；
- Journal、Receipt、Lease、熔断器和子进程诊断。

开发者模式只增加配置和诊断可见性，不会自动放宽工作区、敏感文件、Shell 或外部资源安全策略。
