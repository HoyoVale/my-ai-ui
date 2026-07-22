# Diff UX 2.0 与受控 Process Tool 1.0

版本：95
基线：`my-ai-ui(94)`

## 1. 目标

本阶段同时解决两个 Coding Agent 闭环问题：

1. 文件修改应像 Codex 一样与对应工具调用绑定，最终回复结束后再提供一次去重的总体 Diff。
2. Coding Agent 必须能够在受控边界内执行项目自己的测试、构建、检查脚本，并把命令、实时输出和最终结果纳入 Tool Timeline 与 Goal 验收证据。

## 2. Diff UX 2.0

### 2.1 执行过程中的局部 Diff

以下写工具成功后会生成本次调用的局部 Diff：

- `write_text_file`
- `replace_text_in_file`
- `append_text_file`
- `apply_patch`
- `move_path`
- `delete_path`

局部 Diff 显示在对应工具调用内部，不再在思考过程旁边重复展示全局文件变更框。

### 2.2 Run 级 Baseline → Final Diff

新增 `RunDiffTracker`：

- 第一次修改文件时保存该文件的运行基线；
- 后续重复写入只更新最终状态；
- 最终按文件去重；
- 如果文件最终恢复到基线，不进入最终汇总；
- 最终回复结束后，在消息正文下方显示一次“本次改动”。

支持：

- 新增文件；
- 删除文件；
- 修改文件；
- 重命名；
- 二进制新增、删除和修改；
- 行级新增/删除统计；
- 大文件和长 Diff 截断标记。

### 2.3 持久化

Conversation Store 升级到版本 21。Assistant 消息可以保存有界的 `diffSummary`，历史会话重新打开后仍能查看最终 Diff。

## 3. 命令显示

命令工具现在提供 `commandPreview`：

- 命令进入运行状态时立即显示命令；
- stdout/stderr 以有界增量更新到工具卡片；
- 完成后显示退出码、耗时、截断状态；
- 原始完整结果仍由 Tool Receipt / Tool Result Store 管理；
- 普通 Conversation 投影不会泄露环境变量或未授权参数。

覆盖：

- `run_project_script`
- `git_inspect`
- `git_diff`
- 开发者显式允许的 `run_workspace_command`

## 4. 受控 Process Tool

### 4.1 `run_project_script`

Coding 模式默认开放此工具。模型不能提交任意 Shell 字符串，只能请求：

- `test`
- `build`
- `lint`
- `check`
- `script` + 合法脚本名

脚本必须真实存在于当前目录的 `package.json#scripts` 中。运行时自动识别：

- npm
- pnpm
- yarn
- bun

### 4.2 安全边界

- 不接受 `&&`、管道、重定向等用户提供的 Shell 片段；
- 不接受模型指定环境变量；
- 不接受任意可执行文件路径；
- `cwd` 必须位于授权工作区；
- 使用 `SubprocessSupervisor` 管理超时、取消、进程树和输出上限；
- 设置 `CI=1`、关闭颜色输出，降低交互卡死和 ANSI 噪声；
- 工具属于高风险外部副作用，仍需现有 Approval Policy 授权；
- 自动重试关闭，避免测试或构建脚本发生重复副作用；
- 与工作区写入共享全局调度屏障，命令运行时不允许并发修改工作区。

Windows 下 `.cmd` 启动器由宿主使用固定的 `cmd.exe /d /s /c` 结构调用。包管理器名称来自固定集合，脚本名受 Schema 正则和 `package.json` 存在性双重约束，不接受自由 Shell 文本。

### 4.3 任意命令仍默认关闭

`run_workspace_command` 没有隐式命令白名单。只有开发者在 `allowedCommands` 中明确配置可执行文件后才会进入模型工具集合。

## 5. Tool Scheduler

`run_project_script` 和 `run_workspace_command` 被视为全工作区独占操作：

- 等待当前文件读写结束；
- 执行期间阻止新的工作区写入；
- Plan 控制面屏障仍具有更高顺序保证；
- 取消或超时后由 Subprocess Supervisor 清理进程树并释放调度锁。

## 6. Goal 验收

命令结果会形成结构化证据：

- 显示命令；
- 脚本名；
- 退出码；
- stdout/stderr；
- 执行耗时；
- 是否超时或被取消。

因此 Goal Completion Verifier 可以判断测试或构建是否发生在最后一次代码修改之后，不再只能依赖用户手动粘贴结果。

## 7. 测试

新增 `npm run test:p2-diff-process`，覆盖：

- 多次写入折叠成一个 Baseline → Final Diff；
- 新增、删除、重命名和二进制状态；
- Final Diff 的 Conversation 持久化；
- Tool Result 命令预览持久化；
- 命令在运行阶段提前显示；
- stdout 增量更新；
- 真实执行临时项目的 `npm run probe`；
- 未声明脚本拒绝；
- 任意命令默认不可见；
- Git 变更命令拦截；
- Conversation 局部 Diff 和最终 Diff UI 契约。

## 8. 后续建议

下一步适合在真实 Electron 窗口中补充：

1. 命令卡片滚动和长输出折叠的视觉 E2E；
2. Diff 文件导航、单文件折叠和复制 Patch；
3. 终端 ANSI 的安全解析；
4. 根据项目类型扩展 Python、Rust、CMake 等受控任务适配器；
5. 把成功的测试/构建 Receipt 直接挂入 Goal Criterion Evidence。
