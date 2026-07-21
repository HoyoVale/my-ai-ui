# my-ai-ui 73 稳定性维护审查

## 目标

本轮不增加新的 Agent 功能，集中处理：

1. GitHub CI 的脆弱断言；
2. 系统托盘身份显示；
3. 窗口交互和异步状态一致性；
4. 设置持久化数据链；
5. Agent 基础能力完备性评估。

## 审查计划

### 第一层：交互契约

- Conversation 顶栏 Skill 标识位置；
- 系统托盘名称、菜单和桌宠显示状态；
- Setting、Conversation、Memory 快速切换时的异步刷新；
- Provider 与 MCP 状态快速切换。

### 第二层：状态一致性

- 初始快照与实时广播的先后顺序；
- 较早请求晚返回时是否覆盖新状态；
- 操作结果与后续广播是否相互覆盖；
- 窗口销毁后是否仍提交状态。

### 第三层：持久化链路

- 设置写入失败时内存与磁盘是否一致；
- Windows 文件替换失败时是否可恢复；
- 应用异常中断后是否能恢复备份；
- Tool、Conversation、Memory 原有持久化测试是否继续通过。

### 第四层：Agent Runtime

- Provider、Prompt Stack、Context、Memory；
- Chat/Coding 会话执行上下文；
- Tool Runtime、Approval、Receipt 和恢复；
- MCP、Custom HTTP Tool、Capability；
- Skill Runtime 与依赖；
- Plan Core/UI、Checkpoint、续跑与最终回答流式输出。

## 已发现并修复的问题

### 1. CI 依赖 JSX 排版

`toolV3AndDiffUi70.test.js` 通过固定换行和闭合标签寻找左侧区域终点。组件只要经过格式化或插入空行，测试就会误判 Skill 不在左侧。

现在只验证稳定结构顺序：

```text
conversation-topbar__left
→ conversation-topbar__skill
→ conversation-topbar__right
```

同时更新了旧版托盘测试，不再要求源码中存在写死的“退出 Xixi”。

### 2. 托盘名称写死

托盘 Tooltip、退出菜单和 Pet 设置开关现在统一读取：

```text
settings.personality.name
```

名称为空时回退为“桌面助手”。修改 Personality 名称后，现有托盘会立即更新，不需要重启应用。

托盘菜单还会监听桌宠窗口的 `show`、`hide` 和 `closed`，避免“桌宠已隐藏但菜单仍显示隐藏桌宠”的状态滞后。

### 3. 会话与记忆旧请求覆盖新状态

以下 Hook 原来允许并发刷新，较早请求晚返回时可能覆盖用户刚切换后的状态：

- `useConversationHistory`
- `useMemoryLibrary`
- `useConversations`
- `useMemories`

现在每次刷新都使用请求序号，只接受最新请求结果；组件卸载时会使未完成请求失效。

### 4. Provider 凭据串位

快速切换模型 Provider 时，上一个 Provider 的凭据状态可能晚返回并覆盖当前 Provider。

`useModelCredentials` 现在对读取、保存和清除操作使用独立请求序号，旧 Provider 的响应不会写入新 Provider UI。

### 5. MCP 状态回写竞争

MCP 初始读取、实时广播、手动刷新和操作返回值可能互相覆盖。

现在：

- 初始读取和刷新只接受最新结果；
- 实时广播使旧读取立即失效；
- 操作按钮状态使用独立序号；
- 如果操作期间已经收到更新广播，不再用较旧的操作返回快照覆盖它。

### 6. 设置初始快照覆盖实时广播

普通窗口的 `useAppSettings` 以及 Setting 自身的 `useSettings` 存在以下时序：

```text
发起 getSettings
→ 收到较新的 settingsChanged
→ 较早的 getSettings 晚返回
→ 新设置被旧快照覆盖
```

现在初始快照带有远程序号；一旦收到实时广播，旧快照和旧错误都不会再落地。

### 7. 设置写入不是事务

旧实现先修改内存缓存，再直接覆盖 `settings.json`。磁盘写入失败时会出现：

```text
IPC 报保存失败
但主进程缓存已经变成新设置
磁盘仍是旧设置
```

现在改为：

```text
生成并校验新设置
→ 临时文件写入
→ 原子替换
→ 成功后提交内存缓存
```

Windows 覆盖失败时使用受保护的 `.bak` 交换流程；提交失败会恢复旧文件。应用启动时如果发现“主文件缺失、备份存在”，会先恢复备份。

### 8. MCP 设置异常可能形成未处理 Promise

`applySettingsToOpenWindows` 原来直接丢弃 `mcpClientManager.applySettings()` 的 Promise。异常可能成为未处理拒绝。

现在会捕获并记录错误，不影响其他窗口设置继续应用。

### 9. 系统主题变化重复重放全部 Runtime 设置

旧的 `nativeTheme.updated` 回调会重新应用：

- MCP 连接；
- Circuit Breaker；
- 开机启动；
- 托盘；
- 所有窗口尺寸。

Renderer 已通过 `prefers-color-scheme` 监听系统主题，因此这条全量重放链路属于冗余，并可能在系统主题变化时触发无关副作用。本轮已移除。

## Agent 基础功能完备性

### 已经完备的基础层

| 能力 | 状态 |
|---|---|
| 多 Provider 模型接入与流式输出 | 已具备 |
| Chat/Coding 会话隔离 | 已具备 |
| 工作区绑定与模型快照 | 已具备 |
| Prompt Stack 与 Personality | 已具备 |
| 长短期 Context 与 Memory | 已具备 |
| Tool Registry、Manifest、Capability | 已具备 |
| Tool Read/Write/Delete/Diff | 已具备 |
| Tool Approval 与安全结果隔离 | 已具备 |
| MCP 与 Custom HTTP Tool | 已具备 |
| Skill 安装、路由、组合与依赖 | 已具备 |
| 根计划与内部子计划 | 已具备 |
| Checkpoint、续跑和崩溃恢复 | 已具备 |
| Response/Conversation 增量状态流 | 已具备 |
| Tool 调用后的最终回答流式衔接 | 已具备 |

因此，从“单 Agent 桌面 Host”的角度，基础功能已经形成闭环，可以停止继续堆基础架构，进入产品体验、真实任务验证和专项能力开发阶段。

### 尚不属于基础闭环、可以后续开发的能力

- 图片和附件输入；
- 内置联网搜索或浏览器自动化；
- 后台任务与定时调度；
- 多 Agent 协同；
- OS 级 MCP/脚本沙箱；
- Git 写入工作流（commit、branch、PR）；
- 自动模型降级与跨 Provider 故障转移；
- 完整遥测、评测集和长期稳定性仪表盘；
- 远程 Skill 安装、签名与 Marketplace。

这些属于扩展能力或生产化能力，不应再阻塞当前产品迭代。

## 验证重点

本轮新增或更新的回归覆盖：

- Skill 标识左右区域契约；
- 动态托盘身份；
- 设置文件正常替换；
- Windows 替换回退；
- 写入失败恢复旧设置；
- 中断备份恢复。

完整 Node 测试、Lint、构建、Runtime Crash Matrix 和持久化测试应在发布补丁前全部执行。
