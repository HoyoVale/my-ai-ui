# my-ai-ui 68：输入、字体与代码维护审查

## 本轮目标

本轮不扩展新的产品能力，集中完成三项工作：

1. 修复 Input 输入 `/` 后没有 Skill 辅助菜单的问题。
2. 将 Appearance 的拉丁字体与中文字体改成自由输入，留空时使用系统当前字体。
3. 审查前端和主进程代码，清理过时实现、重复状态与无用 UI，并降低窗口初始加载体积。

## Input `/` Skill 菜单

### 根因

旧实现只有在已经得到非空 Skill 建议时才渲染弹层，同时 Skill Runtime 状态查询没有稳定使用当前会话模式。以下情况都会让用户看到“完全没有反应”：

- Skill 列表仍在加载；
- 当前模式没有可用 Skill；
- 尚未安装或启用 Skill；
- Skill 只支持 Coding，而当前会话是 Chat；
- 查询失败；
- 输入的命令没有匹配项。

### 修复

现在只要光标位于合法的 `/skill-id` 命令位置，菜单就会出现，并显示下列状态之一：

- 正在读取可用 Skill；
- 当前 Chat/Coding 模式没有可用 Skill；
- 没有匹配当前命令的 Skill；
- Skill Runtime 读取失败；
- 可选择的 Skill 列表。

Skill 查询先读取当前会话，再按规范化后的 Chat/Coding 模式请求 Runtime 状态。Skill IPC 失败不会再让整个 Input 上下文一起失败。

## Appearance 字体设置

### 交互

Appearance 现在提供两个自由文本输入框：

- 英文、拉丁字母、数字与符号字体；
- 中文字体。

输入框留空时使用系统当前字体。输入框仍提供经典字体建议，但建议不会限制用户输入任意本机字体名称。

### 兼容性

旧版字体枚举会迁移为可编辑的字体名称。旧 `fontFamily` 和 `customFontFamily` 仍可作为迁移输入读取，但不会继续写入规范化设置，避免新旧字段长期双向同步。

### 字体栈修复

旧字体栈在中文字体之前插入了通用 `sans-serif`。浏览器可能在通用族处完成回退，导致用户选择的中文字体不生效。现在顺序为：

```text
拉丁字体
→ 中文字体
→ 最终 generic family
```

从而保证中英文分别设置后都能参与实际排版。

## 输入状态一致性

通用 TextInput/TextArea 的草稿状态增加了本地引用同步。快速输入后立即按 Tab、点击其他设置项或结束中文输入法组合时，不会再因为失焦读取到旧的服务端快照而恢复旧值。

## 代码清理

### Tool Runtime 恢复 UI

Conversation 中已经删除的全局恢复中心不再保留完整组件和大段 CSS。为兼容增量覆盖及可能存在的旧扩展导入，旧模块路径仅保留极小的无操作兼容层，不再包含界面、状态或业务逻辑。

### 窗口最大化 Hook

Conversation、Memory 和 Setting 原先维护重复的最大化状态 Hook。现在统一到：

```text
src/shared/hooks/useWindowMaximized.js
```

旧导入路径只做轻量重新导出，避免三份实现继续漂移。

### Provider 默认配置

Renderer 与 Electron 主进程原先各维护一套模型 Provider 模板，存在默认值不一致风险。现在统一使用：

```text
src/shared/defaultSettings.js
```

主进程文件仅负责导入、导出与深拷贝。

### Renderer 路由分包

Pet、Input、Response、Conversation、Memory 和 Setting 改为路由级懒加载。每个窗口启动时不再同步加载其他窗口全部代码。

### Setting 面板分包

Setting 的各个页面改为按 Tab 懒加载，同时保留每个 Tab 独立滚动位置。修改设置或 Tool Manifest 刷新不会重新挂载整页，也不会把用户跳到页面末尾。

本次构建中 Setting 入口脚本约为 20.6 KB；Model、MCP、Tools、Skills 等较大面板被拆成独立 Chunk。

## 审查边界

本轮没有进行以下高风险重构：

- 合并 Agent Runtime、Tool Executor 或持久化 Store 中看似相似但生命周期不同的代码；
- 删除设置迁移字段的读取逻辑；
- 移除通过 npm scripts 间接执行、静态分析难以识别的测试文件；
- 重构 Conversation 与 Setting 的大型 CSS 命名体系；
- 改变 Tool、MCP、Skill 的公开协议。

这些区域牵涉恢复、事务、跨进程状态或用户历史数据，激进“去重”带来的风险高于当前收益。

## 验证

- Oxlint：0 warnings / 0 errors
- Node tests：566 passed / 0 failed
- Vite production build：通过
- Tool Runtime crash recovery：通过
- Atomic-write crash matrix：通过
- Runtime benchmark：通过
- 短时 Runtime soak：通过
- npm audit：0 vulnerabilities
- Electron / CJS 测试脚本语法检查：通过

真实 Electron Playwright 窗口测试仍受当前环境 Electron 二进制下载失败影响，未进入应用阶段。
