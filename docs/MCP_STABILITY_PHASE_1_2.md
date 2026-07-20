# MCP Stability Phase 1–2

本补丁基于 `my-ai-ui(53)`，只修改 MCP、Tools 设置与相关测试，目录可直接覆盖到原项目根目录。

## Phase 1

- Custom HTTP Tools 合并到 `Setting → Tools`，删除独立的 Custom Tools 侧栏入口。
- 删除写死的 GitHub / Docker MCP 模板，仅保留通用的本地 stdio 与远程 Streamable HTTP 连接。
- 将原 `McpClientManager` 内部职责拆分为 Registry、Connection、Health、Recovery、Journal、Manifest、Permission 与 Result Sanitizer；原导入路径和公开接口保持兼容。
- 增加 MCP 健康状态、连接诊断和周期性健康检查。
- 增加 my-ai-ui 原生 MCP 备份导入/导出，并支持识别通用 `mcpServers` JSON。
- 导入、导出时不保存 Token、Authorization、Cookie、密码类环境变量的明文值，只保留凭据变量名。

## Phase 2

- 增加 Server Capability Matrix：本地进程、网络、账户、文件读写、外部写入与破坏性操作。
- 增加每个 MCP Tool 的 `inherit / allow / deny` 权限规则；显式允许仍不能越过 Server 级安全边界。
- 增加 MCP Result Sanitizer：限制文本、结构化数据、JSON 字段和内容块；清理 HTML；拒绝二进制内容直接进入模型上下文；标记疑似 Prompt Injection。
- 增加 Tool Manifest 数字修订与稳定哈希；工具清单变化写入 `MCP_TOOLSET_CHANGED` Journal 事件。
- 增加有界指数退避恢复；健康检查失败、连接关闭或只读工具调用失败时可按策略恢复。
- 增加连接代次和断开锁，防止旧连接在配置变更后覆盖新状态或重复关闭。
- 日志分为 User、Developer、Debug，并在进入日志前清理常见凭据。

## 兼容与迁移

- 旧 `github-readonly` preset 自动归一化为普通 `custom` 连接，不会在升级后阻止设置加载。
- 旧 MCP Server 未配置 `permissions` 或 `recovery` 时会补充安全默认值。
- 旧版只读 MCP 的无注解工具，仅对 `read/get/list/search/find/query/fetch/inspect...` 等明显读取型名称进行兼容推断；明确标记为写入或名称不明的工具仍会被只读策略阻止。
- 原 `McpClientManager` 文件仍存在，作为 `McpConnectionManager` 的兼容外观，现有调用方无需修改 import。

## 安全边界说明

权限矩阵是 Host 层调用门控，不等同于操作系统沙箱。stdio MCP 子进程仍继承当前桌面应用用户在操作系统中的权限。高风险 Server 仍应运行在受限账户、容器或其他隔离环境中。

## 覆盖安装

1. 关闭正在运行的应用。
2. 解压补丁到 `my-ai-ui(53)` 项目根目录并允许覆盖同名文件。
3. 执行：

```powershell
npm ci
npm run check
```

补丁不包含 `node_modules`、`dist`、用户设置、凭据或构建缓存。
