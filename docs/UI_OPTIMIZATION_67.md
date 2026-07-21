# UI Optimization 67

本轮基于 `my-ai-ui(67)`，集中优化 Setting、Conversation、Input 与 Response，并补充文件改动 Diff 展示。

## Setting

- Appearance 将拉丁字符字体与中文字体分开配置，并提供系统字体、Segoe UI、Inter、Arial、Georgia、Cascadia Code、微软雅黑、苹方、Noto Sans CJK、思源黑体和宋体等后备字体栈。
- Pet 增加系统托盘开关；托盘可显示/隐藏桌宠并打开 Input、Conversation 与 Setting。
- Response 垂直锚点允许负值，可向屏幕上方偏移。
- Personality 删除头像介绍；回复偏好改为自由文本。
- Skills 页面改为紧凑命令栏、状态概览、搜索筛选和渐进展开详情。
- Setting 内容区按页面保存滚动位置；Tool Manifest 刷新期间保留原内容，避免保存设置时跳到页面底部。

## Conversation

- 会话名称使用省略显示，侧栏禁止横向滚动，重命名与删除操作始终可见。
- 删除顶部新建会话按钮；每个工作区标题提供独立的新建按钮，并携带当前 Chat/Coding 模式与工作区。
- 移除 Conversation 中的 Tool Runtime 恢复中心入口。
- 写入、替换、追加和补丁操作生成有界 Unified Diff；运行中显示在 Tool 活动里，完成后保留在 Assistant 消息下方。

## Input

- `+` 菜单增加 MCP 总开关和单连接快捷开关；修改只影响后续任务快照。
- 输入 `/` 时显示可用 Skill 建议，支持键盘上下选择、Enter/Tab 插入与 Escape 关闭。
- `+` 和 `/` 弹层根据屏幕可用空间自动向上或向下展开。
- 向上展开时 Electron 窗口同步上移，并在弹层打开期间临时提升至 Pet 窗口之上；关闭后恢复用户配置的置顶状态。

## Response

- 只有 `scrollHeight` 实际超过 `clientHeight` 时才启用垂直滚动条。
- 内容未溢出时强制清除滚动状态，避免短回复出现无意义滚动条。

## 安全与边界

- MCP 快捷开关只能修改已有连接的启用状态，不能从 Input 修改命令、URL、认证或权限。
- 文件 Diff 只保留有界预览；大结果分页后仍单独保留 Diff 元数据。
- 系统托盘不改变 Tool、MCP、Skill 或工作区权限。
