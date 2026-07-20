# Tool 与 Skill 开发路线

> 基线：`my-ai-ui(60)`  
> 当前阶段：Tool Read 2.0  
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
| Skill Foundation | 安装、校验、启停和卸载 Skill | Skill 可以安全进入本地 Registry |
| Skill Runtime | 显式选择 Skill，并解析能力和权限 | Skill 能参与真实 Agent Run |
| Skill Advanced | 自动路由、组合、更新、签名和市场 | 形成可扩展 Skill 生态 |

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

下一阶段计划。

### 3.1 增强 `write_text_file`

计划增加：

```js
{
  path,
  content,
  expectedSha256,
  createOnly,
  overwrite,
  preserveNewline,
  encoding
}
```

要求：

- Approval 前无副作用；
- 原子写入；
- 可选 SHA-256 前置条件；
- 默认保留原编码与换行；
- 返回修改前后 Hash、字节差异和 Receipt；
- 崩溃后可核验结果。

### 3.2 `replace_text_in_file`

用于精确替换：

```js
{
  path,
  oldText,
  newText,
  expectedOccurrences,
  expectedSha256
}
```

零次或多次匹配时不猜测。

### 3.3 `apply_patch`

支持受限 Unified Diff：

- 先 dry-run；
- 所有 hunk 可应用后才写入；
- 多文件修改整体提交或整体回滚；
- 禁止绝对路径和 `../`；
- 所有目标必须位于同一授权工作区；
- Approval 卡片显示文件与增删行摘要。

### 3.4 其他写入工具

第一批：

- `append_text_file`
- `create_directory`
- `move_path`

后续独立开放：

- `delete_path`

删除工具要求永久逐次批准，不能使用“本任务内允许”。

### 3.5 统一写入证据

所有写工具计划返回：

```js
{
  operation,
  affectedPaths,
  beforeSha256,
  afterSha256,
  bytesChanged,
  receiptId,
  rollbackAvailable,
  warnings
}
```

---

## 四、补丁 3：Capability Foundation

目标：让 Skill 依赖能力，而不是写死工具名称。

### 4.1 Capability Taxonomy

第一版建议：

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

agent.plan
agent.result.page
```

### 4.2 Risk Taxonomy

```text
read
local_write
external_write
destructive
credential
process
network
```

### 4.3 来源

```text
built_in
mcp
custom_http
plugin
```

### 4.4 Resolver

```text
requiredCapabilities
    ↓
当前可用 Tool Manifest
    ↓
模式、工作区、用户权限、Tool/MCP 权限求交集
    ↓
实际工具集合
```

Capability 只能缩小权限，不能扩大权限。

---

## 五、补丁 4：Skill Foundation

### 5.1 本地目录结构

```text
skills/
└─ code-review/
   ├─ skill.json
   ├─ SKILL.md
   ├─ resources/
   ├─ templates/
   └─ tests/
```

### 5.2 `skill.json`

机器可读：

```json
{
  "schemaVersion": 1,
  "id": "code-review",
  "name": "Code Review",
  "version": "1.0.0",
  "description": "检查代码改动并生成审查报告",
  "modes": ["Coding"],
  "requiredCapabilities": [
    "workspace.file.read",
    "workspace.file.search",
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

### 5.3 `SKILL.md`

模型可读工作流程，但不能声明或提升真实权限。

### 5.4 安装

第一版仅支持：

- 导入本地文件夹；
- 导入本地 ZIP；
- 从本地路径加载。

安装前检查：

- Manifest Schema；
- ZIP 路径穿越；
- 绝对路径；
- 符号链接逃逸；
- 单文件、总大小、文件数；
- 压缩炸弹；
- Capability 与权限摘要。

---

## 六、补丁 5：Skill Runtime

第一版只支持显式触发：

- Input 菜单选择 Skill；
- `/skill-id`；
- 模型建议后由用户确认。

运行权限：

```text
Skill 声明权限
∩ 用户设置
∩ 当前 Chat/Coding 模式
∩ 当前工作区
∩ Tool/MCP 权限
= 实际权限
```

Conversation 只需显示：

```text
正在使用 Debug Skill
```

开发者展开后显示 Capability、实际工具、Prompt Stack 和加载诊断。

---

## 七、补丁 6：Skill Advanced

基础系统稳定后再考虑：

- 自动 Skill Router；
- Skill 组合；
- Skill 依赖；
- 版本更新；
- 来源签名；
- Marketplace；
- 远程安装；
- Skill 自带可执行脚本的沙箱。

第一版不允许 Skill 直接执行任意脚本。

---

## 八、长期约束

1. 系统工具数量应保持克制，避免相似工具过多导致模型误选。
2. 所有读写都必须经过统一 Tool Runtime。
3. Skill、MCP、Custom HTTP 不能绕过权限、Approval 和 Result Sanitizer。
4. 本地 MCP 进程不等同于 OS 沙箱。
5. 所有写入必须可核验；破坏性操作必须逐次批准。
6. 普通模式保持简洁；Manifest、原始参数、日志和诊断仅在 Developer mode 展示。
7. 新阶段开始前先冻结上一阶段对外 Schema，并补回归测试。
