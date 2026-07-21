# Tool 与 Skill 开发路线

> 基线：`my-ai-ui(65)`  
> 当前阶段：Skill Advanced 核心能力已实施  
> 原则：先稳定系统工具与能力协议，再建设 Skill；Skill 不能绕过 Tool Runtime、工作区边界或用户批准。

## 一、总体路线

```text
Tool Read 2.0
    ↓
Tool Write 2.0
    ↓
Capability Foundation
    ↓
Skill Foundation
    ↓
Skill Runtime
    ↓
Skill Advanced
```

| 阶段 | 主要目标 | 阶段出口 |
|---|---|---|
| Tool Read 2.0 | 增强项目浏览、批量读取、搜索与 Git 差异读取 | Agent 能够可靠理解中小型代码仓库 |
| Tool Write 2.0 | 增强精确改写、补丁、目录与路径操作 | Agent 能够安全、可核验地修改工作区 |
| Capability Foundation | 建立工具能力、风险和来源协议 | Skill 不依赖具体工具名称 |
| Skill Foundation | 安装、校验、启停和卸载 Skill | **已实施：Skill 可以安全进入本地 Registry** |
| Skill Runtime | 显式选择 Skill，并解析能力和权限 | **已实施并完成稳定化审查** |
| Skill Advanced | 命令调用、保守路由、组合与声明式依赖 | **核心能力已实施；更新、签名和市场暂缓** |

---

## 二、补丁 1：Tool Read 2.0

状态：**已实施**。

### 2.1 `read_text_file` 增强

支持：

- 任意起止行的有界读取；
- 调用级 `maxBytes`，不能超过工作区全局上限；
- `auto / utf8 / utf16le` 编码；
- UTF-8 BOM、UTF-16LE BOM 检测；
- LF、CRLF、CR、混合换行识别；
- 可选行号；
- 文件大小、总行数、下一读取位置；
- SHA-256；
- 读取期间文件变化检测；
- 二进制、非法编码、敏感路径和符号链接逃逸阻断。

统一返回的主要字段：

```js
{
  root,
  path,
  startLine,
  endLine,
  totalLines,
  content,
  truncated,
  hasMoreBefore,
  hasMoreAfter,
  nextStartLine,
  sizeBytes,
  encoding,
  bom,
  newline,
  sha256,
  includeLineNumbers
}
```

### 2.2 `read_multiple_files`

用于一次读取多个小文件：

- 最多 20 个路径；
- 单文件字节上限；
- 整批总字节上限；
- 单文件失败不会中断整批；
- 每个结果独立返回成功数据或标准错误；
- 继续遵守敏感文件、固定排除目录与符号链接安全策略。

### 2.3 `list_directory` 增强

新增：

- 递归深度；
- 隐藏文件开关；
- ignore Glob；
- 按名称、类型、大小、修改时间排序；
- 相对路径、深度、文件类型、大小、修改时间；
- 扫描数量、跳过数量、截断原因。

固定排除目录仍不会因参数而放开：

```text
.git
node_modules
dist
build
coverage
.cache
.next
.vite
test-results
playwright-report
```

### 2.4 `list_directory_tree`

用于生成有限深度项目树：

- 深度上限；
- 条目上限；
- ignore Glob；
- 隐藏文件开关；
- 文本树与结构化条目同时返回；
- 不跟随符号链接；
- 明确返回截断状态。

### 2.5 `search_files` 增强

支持：

- `glob`，并兼容旧 `pattern`；
- exclude Glob；
- 文件、目录或全部类型；
- 最小和最大文件大小；
- 修改时间过滤；
- 隐藏文件开关；
- 深度与结果上限；
- 稳定顺序；
- 路径列表与结构化 metadata。

### 2.6 `search_text` 增强

支持：

- 字面文本；
- 大小写；
- 整词匹配；
- 受限正则；
- include / exclude Glob；
- 旧 extensions 参数；
- 前后上下文；
- 单文件匹配上限；
- 全局匹配、扫描文件、扫描字节与深度上限；
- 行号、列号和上下文返回。

正则安全边界：

- 长度上限；
- 禁止反向引用；
- 禁止前后向断言；
- 拒绝明显的嵌套量词；
- 逐行匹配，避免对整个大型文件做无界模式计算。

### 2.7 `inspect_path`

返回：

- 路径是否存在；
- 文件、目录或缺失类型；
- 大小和时间；
- 文本编码与换行；
- SHA-256；
- 是否为安全符号链接及其工作区内目标；
- 是否可读取。

旧 `stat_path` 暂时保留为兼容入口。

### 2.8 `git_diff`

作为默认工作区只读工具提供：

```text
unstaged
staged
all
range
```

安全约束：

- 参数由 Host 构造；
- 不使用 Shell；
- 禁止 external diff 和 textconv；
- 禁止输出文件；
- 禁止越界、固定排除目录和敏感文件 pathspec；
- 无论是否指定路径，都使用 Git exclude pathspec 排除凭据文件与固定排除目录；
- revision 使用保守允许字符；
- 输出、上下文行数和运行时间有界；
- 由 Subprocess Supervisor 处理取消、超时和进程回收。

### 2.9 Tool Read 2.0 验收标准

- 旧参数仍可工作；
- 工作区外路径不可读取；
- 敏感文件不可读取；
- 固定排除目录不可递归扫描；
- 符号链接不能逃逸；
- 所有大型结果具备显式限制与截断信息；
- 新工具进入统一 Manifest、Tools 设置和 Agent Toolset；
- 单元测试、Lint 与生产构建通过。

---

## 三、补丁 2：Tool Write 2.0

状态：**已实施**。

### 3.1 `write_text_file` 增强

支持：

```js
{
  path,
  content,
  encoding,
  expectedSha256,
  createDirectories,
  createOnly,
  overwrite,
  preserveNewline,
  dryRun
}
```

实现能力：

- 保持旧参数兼容；
- UTF-8、UTF-8 BOM、UTF-16LE 编码；
- 默认保留已有文件的编码、BOM 与换行风格；
- `createOnly` 与 `overwrite` 明确表达创建和覆盖意图；
- 可选 SHA-256 乐观并发检查；
- Dry-run 只生成预览和证据，不产生文件副作用；
- 临时文件写入、`fsync`、原子替换与写后 Hash 校验；
- 已完成替换后若校验或边界钩子失败，恢复修改前内容；
- 返回统一 Receipt 和修改证据。

### 3.2 `replace_text_in_file`

用于精确文本替换：

```js
{
  path,
  oldText,
  newText,
  expectedOccurrences,
  expectedSha256,
  dryRun
}
```

规则：

- 默认要求旧文本只出现一次；
- 零次或匹配次数与预期不一致时拒绝修改；
- 不使用模糊匹配，不替模型猜测目标位置；
- 保留原编码、BOM 和换行；
- 支持 Hash 前置条件、Dry-run、原子写入与 Receipt。

### 3.3 `apply_patch`

支持受限的标准 Unified Diff：

- 默认最多 20 个文件，补丁文本默认上限 500 KB；
- 所有文件和 hunk 先完整解析、路径校验和内存预应用；
- 所有目标必须位于同一个授权工作区；
- 禁止绝对路径、路径穿越、重复文件、删除与重命名；
- 支持现有文件修改和显式新文件创建；
- 支持单文件 `expectedSha256` 前置条件；
- Dry-run 返回文件、增删行和 Hash 摘要；
- 多文件先全部写入临时文件，再进入事务提交；
- 事务内任一提交或校验失败，会恢复已经提交的文件；
- 不覆盖上次异常退出遗留的 `.bak` 恢复证据，而是返回 `WRITE_TRANSACTION_RECOVERY_REQUIRED`；
- 成功后返回事务级 Receipt 和各文件写前、写后证据。

当前不支持：

- 文件删除；
- 文件重命名；
- Git binary patch；
- 任意非 Unified Diff 自定义补丁语法。

### 3.4 `append_text_file`

能力：

- 文件不存在时默认拒绝；
- 必须显式设置 `createIfMissing` 才允许创建；
- 可安全插入换行分隔符；
- 保留已有编码、BOM 和换行；
- 支持 Hash、Dry-run、原子替换与 Receipt。

追加不是直接以 `append` 模式写入磁盘，而是读取、生成目标内容后执行原子替换，避免部分追加。

### 3.5 `create_directory`

能力：

- 支持单层或显式递归创建；
- 已存在目录按幂等成功处理；
- 文件占用目标路径时拒绝；
- 支持 Dry-run；
- 遵守工作区、敏感路径和符号链接边界；
- 返回目录创建 Receipt。

### 3.6 `move_path`

能力：

- 文件或目录只能在同一授权工作区内移动；
- 默认且当前固定禁止覆盖目标；
- 禁止把目录移动到自身内部；
- 禁止符号链接逃逸；
- 文件移动后执行 Hash 核验；
- 已完成移动后若核验失败，在进程内尝试回滚；
- 支持 Dry-run 和 Receipt。

### 3.7 统一写入证据与 Runtime 契约

所有写工具统一提供或持久化：

```js
{
  operation,
  affectedPaths,
  beforeSha256,
  afterSha256,
  bytesChanged,
  receiptId,
  rollbackAvailable,
  rollbackPerformed,
  addedLines,
  removedLines,
  warnings,
  effectEvidence
}
```

同时接入：

- Tool Approval；
- Tool Receipt Store；
- 幂等键；
- 运行时核验与 Reconciliation；
- Abort、Lease 和崩溃恢复状态；
- 工作区写入并发键。

`ToolExecutor` 会在执行成功前预留最终 Receipt ID，使工具返回值和持久化 Receipt 使用同一标识。

### 3.8 原子性与回滚边界

当前保证：

- 单文件：临时文件 + 文件同步 + 原子替换 + 写后 Hash；
- 多文件补丁：全部预检和暂存后提交，捕获到事务错误时恢复已提交文件；
- Dry-run 无写副作用；
- Approval 前无写副作用；
- 临时文件和成功事务备份会清理；
- 发现异常退出遗留备份时停止新事务，保留恢复证据。

需要明确：多数桌面文件系统不提供真正的跨文件原子事务。当前多文件能力属于**应用层事务与进程内回滚**；若进程在多个 rename 之间被操作系统强制终止，可能需要未来的 Recovery Center 根据保留的事务证据执行显式恢复。

### 3.9 暂不包含 `delete_path`

删除工具将在独立补丁中设计，要求：

- 永远逐次批准；
- 不能使用“本任务内允许”；
- 禁止删除工作区根目录和 `.git`；
- 优先进入系统回收站，而不是直接永久删除；
- 目录递归删除必须单独声明并展示影响范围。

### 3.10 Tool Write 2.0 验收标准

- 旧 `write_text_file` 调用继续工作；
- Approval 前和 Dry-run 不产生副作用；
- 编码、BOM 与换行保持可验证；
- Hash 冲突拒绝修改；
- 精确替换拒绝歧义；
- Patch 先全量预检，再事务提交；
- 注入提交失败后所有已提交文件恢复；
- 异常遗留备份不会被新事务静默删除；
- Receipt ID、持久化证据和工具返回一致；
- 单元测试、Lint、生产构建、写入崩溃矩阵和运行时测试通过。

---

## 四、补丁 3：Capability Foundation

状态：**已实施**。

目标：让 Skill、MCP 和 Custom HTTP 依赖统一能力，而不是写死具体工具名称。

### 4.1 Capability Taxonomy

第一版 Schema 与 Taxonomy 已冻结为：

```text
schemaVersion: 1
taxonomyVersion: 1
```

当前能力：

```text
runtime.info
runtime.calculate

workspace.list
workspace.file.read
workspace.file.search
workspace.file.compare
workspace.file.create
workspace.file.modify
workspace.file.move
workspace.file.delete
workspace.project.inspect

git.read.status
git.read.diff

network.read
external.read
external.write
process.execute

agent.plan
agent.result.page
```

每个 Capability 都包含：

- 稳定 ID；
- 中文标题与说明；
- 分类；
- 适用 Chat / Coding 模式；
- 风险类型；
- 权限要求。

Taxonomy 同时生成稳定 SHA-256 Hash，供 Skill 安装校验、缓存和兼容性检查。

### 4.2 Tool → Capability 映射

所有 Tool Definition 统一新增：

```js
{
  capabilities,
  capabilityEvidence,
  permissionRequirements
}
```

映射来源：

- 内置工具：使用固定名称映射；
- MCP：使用 Runtime effect、MCP annotations 和声明能力推断；
- Custom HTTP：使用 HTTP 读写语义与网络权限推断；
- 未来 Plugin：可显式声明 Capability；
- 未声明工具：使用保守 Runtime fallback，不提升权限。

一个 Capability 可以由多个工具提供；一个工具也可以提供多个 Capability。

### 4.3 Permission Envelope

权限不再只是布尔值，而是三级：

```text
allow
ask
deny
```

当前权限维度：

```text
runtime
workspaceRead
workspaceWrite
process
network
externalRead
externalWrite
destructive
credential
account
agentInternal
```

权限结果按最严格规则求交集：

```text
当前模式与工作区权限
∩ 用户 Tool / MCP 配置
∩ Skill 声明权限
∩ Tool 自身额外权限要求
= Effective Permission Envelope
```

排序为：

```text
deny < ask < allow
```

因此 Skill 或外部配置只能缩小权限，不能把 `deny` 提升为 `ask` 或 `allow`。

### 4.4 Capability Resolver

Resolver 输入：

```js
{
  requiredCapabilities,
  optionalCapabilities,
  permissions
}
```

解析流程：

```text
Capability Request
    ↓
统一 Tool Manifest
    ↓
模式、工作区、Tool 开关与 MCP 权限
    ↓
Permission Intersection
    ↓
按 Built-in → MCP → Custom 的稳定顺序选择 Provider
    ↓
实际工具集合与缺失能力
```

Resolver 返回：

- 必需能力是否全部满足；
- 缺失的必需能力；
- 不可用的可选能力；
- 每项能力的所有 Provider；
- 实际选中的 Tool；
- 每个 Tool 的权限判断；
- Effective Permission Envelope；
- Taxonomy Version 与 Hash。

当前 Agent Session 已接入 Resolver：

- 没有 Capability Request 时保持原有工具集合；
- 传入 Capability Request 时只暴露满足请求且未被权限拒绝的工具；
- Chat 不能通过 Capability 请求获得工作区写入或进程执行；
- Coding 写入仍保持 Approval；
- 未知必需能力会明确列入 `missingRequired`。

### 4.5 Manifest Revision

Tool Manifest 现在同时提供：

```js
{
  revision,          // 兼容字段，等于稳定 Manifest Hash
  manifestHash,      // 跨重启稳定的语义 Hash
  manifestRevision,  // 当前会话内单调递增 Revision
  manifestChanged
}
```

Revision 只在语义 Manifest 变化时递增，时间戳刷新不会制造新 Revision。

Skill Runtime 可以使用：

- `manifestHash` 判断缓存是否仍有效；
- `manifestRevision` 判断当前会话是否需要重新解析能力；
- `taxonomyHash` 判断 Skill 是否依赖未知或不兼容的 Taxonomy。

### 4.6 Developer Capability Inspector

Developer 页面新增 Capability Inspector，显示：

- Taxonomy Version 与 Hash；
- 已注册和当前可用 Capability 数量；
- Effective Permission Envelope；
- 每项 Capability 的模式、风险和权限；
- Built-in、MCP、Custom Provider；
- 实际可用状态；
- 缺失的必需能力；
- Manifest Revision 与 Hash。

普通用户页面不展示内部 Capability、Provider 或权限交集细节。

### 4.7 Capability Foundation 验收标准

- 所有已注册 Tool 都有至少一个 Capability；
- 内置、MCP 和 Custom HTTP 使用同一 Manifest 字段；
- Chat / Coding 与工作区边界不能被 Capability Request 绕过；
- Permission Envelope 只能收紧权限；
- 必需和可选 Capability 可独立解析；
- 多 Provider 选择顺序稳定；
- 未知必需 Capability 明确失败；
- Manifest Hash 稳定，Revision 只在语义变化时递增；
- Developer Inspector 使用同一 Manifest 数据源；
- 单元测试、Lint 和生产构建通过。

---

## 五、补丁 4：Skill Foundation

状态：**已实施**。

### 5.1 Skill 包结构

第一版采用本地、不可执行的 Skill 包：

```text
skills/
└─ example-skill/
   ├─ skill.json
   ├─ SKILL.md
   ├─ resources/
   ├─ templates/
   └─ tests/
```

根目录必须包含 `skill.json` 和 `SKILL.md`。第一版不会执行 Skill 包中的脚本，`resources`、`templates` 与 `tests` 只作为静态文件保存。

### 5.2 `skill.json`

Manifest 使用严格 Schema，主要字段：

```json
{
  "schemaVersion": 1,
  "id": "code-review",
  "name": "Code Review",
  "version": "1.0.0",
  "description": "检查当前工作区的代码改动。",
  "modes": ["coding"],
  "requiredCapabilities": [
    "workspace.file.read",
    "git.read.diff"
  ],
  "optionalCapabilities": [
    "workspace.file.modify"
  ],
  "permissions": {
    "localWrite": "ask",
    "externalWrite": "deny",
    "destructive": "deny"
  }
}
```

校验包括：

- Schema 版本；
- Skill ID；
- 语义化版本；
- Chat / Coding 模式；
- Capability 是否存在；
- 必需与可选能力不能重复；
- 权限只能是 `allow / ask / deny`；
- 未声明的权限默认 `deny`。

### 5.3 `SKILL.md`

要求：

- 非空；
- 至少包含一个 Markdown 标题；
- 最大 64 KB，较大的静态资料放入 `resources`；
- 安装时生成稳定 Prompt Hash；
- Foundation 阶段只保存和校验，不注入 Agent Prompt。

### 5.4 安全导入

支持：

- 导入本地文件夹；
- 导入 ZIP；
- ZIP 外包一层目录；
- 临时目录预检后再安装。

固定安全边界：

- ZIP 最大 20 MB；
- 解压后最大 25 MB；
- 最多 512 个文件；
- 单文件最大 5 MB；
- 最大目录深度与路径长度；
- 禁止绝对路径和 `..` 路径穿越；
- 禁止符号链接和特殊文件；
- 限制根目录允许的文件与目录；
- 安装前完整校验 Manifest、Markdown 和包 Hash；
- 安装和卸载采用临时目录、备份或隔离目录，失败时恢复。

### 5.5 Skill Registry

Registry 保存：

- Manifest；
- 启用状态；
- 安装来源；
- 安装和更新时间；
- Manifest、Prompt 与 Package Hash；
- 文件数量和总大小。

读取 Registry 时会重新校验持久化数据，阻止被篡改的 ID 或路径进入文件系统操作。列表会报告：

```text
verified
changed
missing
invalid
```

文件完整性异常时不能重新启用，但仍允许禁用或卸载。

### 5.6 Setting → Skills

普通模式提供：

- 导入文件夹；
- 导入 ZIP；
- 启用 / 禁用；
- 卸载；
- 模式、能力与权限概览；
- 完整性状态。

开发者模式额外显示：

- 安装路径；
- 来源；
- Manifest Hash；
- Prompt Hash；
- Package Hash；
- 文件数量、大小和校验错误。

### 5.7 Skill Foundation 阶段边界

本阶段**不会**：

- 自动选择 Skill；
- 将 `SKILL.md` 注入 Prompt；
- 为 Skill 解析实际 Tool；
- 执行 Skill 包脚本；
- 从网络或 Marketplace 安装；
- 自动更新。

这些能力属于下一阶段 **Skill Runtime** 或后续 Skill Advanced。

---

## 六、补丁 5：Skill Runtime

状态：**已实施**。

### 6.1 显式会话选择

Input 的上下文菜单新增 Skill 页面。用户可以为当前会话选择一个已启用、完整性通过且支持当前 Chat/Coding 模式的 Skill，也可以随时切回“无 Skill”。Skill 绑定保存到 Conversation，不使用全局 Skill 状态。

### 6.2 Skill Prompt Stack

`SKILL.md` 经过完整性校验后进入独立 `skill` authority 层：

```text
Application Policy
→ Runtime / Capability
→ Developer Instructions
→ Skill Workflow
→ Personality / Preferences
→ Context Data
```

Skill Prompt 不能覆盖产品策略、开发者指令、工作区边界、Tool 权限、Approval 或用户最新请求。

### 6.3 Capability 与 Tool 映射

每次 Agent Run 都会使用 Skill 的 `requiredCapabilities`、`optionalCapabilities` 和权限声明重新解析 Tool：

```text
Skill Capability Request
∩ 当前 Chat/Coding 模式
∩ 当前工作区
∩ Tool 开关与来源权限
∩ MCP / Custom HTTP 权限
= 本次实际 Tool Set
```

缺少必需 Capability 时，Run 在模型调用前明确失败，不会让模型假装具备该能力。

### 6.4 权限继承

Skill 权限只能收紧：

```text
Skill 声明权限
∩ 用户设置
∩ 当前模式与工作区
∩ Tool/MCP 权限
= 实际权限
```

`ask` 不仅出现在诊断中，也会进入 Tool Approval；Skill 不能将现有 `deny` 提升为 `allow`。

### 6.5 Conversation 状态与执行日志

Conversation 保存：

- `skillId`；
- 安装时快照；
- Assistant 消息中的 `skillRun`；
- 实际映射 Tool；
- 缺失 Capability；
- 开始、完成、失败、取消或中断状态。

Conversation 顶栏显示当前 Skill，思考时间线和任务活动面板显示 Skill 加载、工具映射和最终执行状态。

### 6.6 Skill Runtime 测试框架

Setting → Skills 增加“运行检查”，在当前会话执行上下文中验证：

- Skill 完整性与模式；
- Prompt 可读取；
- 必需 Capability；
- 实际 Tool 映射；
- 权限求交集。

自动化测试覆盖 Skill 解析、Prompt authority 顺序、会话绑定、Capability 限定 Tool Set，以及 `ask` 权限传递。

### 6.7 UI

Skills 页面增加搜索、状态筛选、Runtime 检查报告、能力与权限分组以及更简洁的包结构说明。普通模式展示运行所需信息，Developer mode 才显示路径和 Hash。

### 6.8 稳定化补充

在进入 Skill Advanced 前，Runtime 已增加以下稳定性约束：

- 会话、续跑、重新生成和恢复任务统一使用同一 Skill 快照；
- 快照保存版本、Capability、权限与 Manifest/Prompt/Package Hash；
- Skill 在任务中途发生更新时拒绝静默续跑，要求新建任务或重新选择；
- Skill Capability 过滤 Tool 时，仍保留受权限约束的计划与大型结果分页工具；
- 切换目标模式或工作区时，Skill 只作为新会话草稿，不会误改当前会话；
- 已禁用、卸载或完整性异常的绑定会明确提示并允许清除；
- Registry 广播失败不再回滚已经成功持久化的安装或状态修改；
- Registry 自动去重，前端异步状态更新按 Revision 和请求序列防止旧结果覆盖；
- Runtime 检查报告在 Registry 变化后自动失效，避免显示过期诊断；
- 重复模式、过大的 SKILL.md 和空 Skill 测试请求会返回明确错误。

详细审查记录见 `docs/SKILL_RUNTIME_STABILITY.md`。

### 6.9 阶段边界

本阶段不实现：

- 自动 Skill Router；
- 多 Skill 组合；
- `/skill-id` 命令；
- Skill 依赖与更新；
- 网络安装和 Marketplace；
- Skill 脚本执行。

这些能力留给 Skill Advanced。

---

## 七、补丁 6：Skill Advanced

状态：**核心能力已实施**。

本阶段完成：

- `/skill-id` 一次性调用；
- 一次性多 Skill 命令组合；
- 会话显式组合最多 4 个根 Skill；
- 本地、可解释、保守的自动 Skill Router；
- `keywords` 路由关键词；
- 声明式 Skill 依赖；
- 语义化版本范围；
- 拓扑加载、循环检测、缺失与版本诊断；
- 根 Skill、依赖和 Prompt 总量上限；
- 多 Skill Capability 合并与权限最严格交集；
- 命令、Router、续跑、恢复和重新生成的快照一致性；
- Input、Conversation 与 Setting 的组合、Router 和依赖 UI。

固定限制：

```text
根 Skill 最多 4 个
根 Skill + 依赖最多 12 个
自动 Router 每次最多选择 1 个根 Skill
组合后的 Skill Prompt 最多 128 KB
```

详细设计见 `docs/SKILL_ADVANCED.md`。

继续暂缓：

- 远程安装；
- 自动更新；
- 来源签名；
- Marketplace；
- Skill 自带可执行脚本与沙箱。

第一版继续禁止 Skill 直接执行任意脚本。

---

## 八、长期约束

1. 系统工具数量应保持克制，避免相似工具过多导致模型误选。
2. 所有读写都必须经过统一 Tool Runtime。
3. Skill、MCP、Custom HTTP 不能绕过权限、Approval 和 Result Sanitizer。
4. 本地 MCP 进程不等同于 OS 沙箱。
5. 所有写入必须可核验；破坏性操作必须逐次批准。
6. 普通模式保持简洁；Manifest、原始参数、日志和诊断仅在 Developer mode 展示。
7. 新阶段开始前先冻结上一阶段对外 Schema，并补回归测试。
