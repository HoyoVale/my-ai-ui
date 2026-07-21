# Tool V3 与 Diff UI 优化（基线 70）

## 已完成

### 只读工具第三波

新增 `compare_files`：

- 比较同一授权工作区内的两个安全文本文件；
- 支持 UTF-8、UTF-16LE、BOM 和换行识别；
- 返回两侧 SHA-256、大小、编码和换行信息；
- 返回新增/删除行统计与有界 Unified Diff；
- 不生成文件写入活动，也不会被误报为实际文件改动。

### 修改工具第三波

新增 `delete_path`：

- 文件与目录永久删除；
- 永远按 `destructive` 风险进入逐次批准；
- 支持 Dry-run；
- 文件支持 `expectedSha256` 前置条件；
- 非空目录要求显式 `recursive=true`；
- 拒绝工作区根目录、敏感路径、固定排除目录、符号链接和特殊路径；
- 递归删除限制条目数与总字节数；
- 先原子移动到同目录隔离路径，再执行删除；失败时尝试恢复原路径；
- 检测到上次异常遗留隔离路径时停止并要求人工核验。

当前实现为永久删除，不依赖 Electron 回收站 API，以保持 Tool Runtime、测试与主进程边界清晰。Approval 卡片必须明确显示目标路径、递归标志和 Dry-run 状态。

### Capability

- `compare_files` → `workspace.file.compare`
- `delete_path` → `workspace.file.delete`
- `delete_path` 同时要求 `workspaceWrite` 和 `destructive` 权限。

### Conversation 顶部

Skill / Auto Skill 标识移入左侧区域，紧随侧栏按钮，不再占据标题栏中央。

### Diff UI

Diff 视图调整为代码审查式布局：

- 文件级标题；
- 每个文件的新增/删除统计；
- 总改动次数与唯一文件数；
- 旧行号、新行号双列；
- 增加、删除、上下文和 Hunk 分层；
- 明暗主题适配；
- 大型 Diff 保持有界滚动和截断说明。

## 未在本阶段实施

Plan 分层尚未修改。现有 `RunPlanStore`、`update_plan` Schema、消息持久化和 Plan Dock 保持原状，等待产品设计确认后再进入开发。
