# Tool Runtime 第五阶段：真实写工具与终极验收

## 1. 阶段目标

第五阶段把前四阶段建立的状态机、Journal、Receipt、Lease、Checkpoint、Recovery Center 和增量 IPC，真正接入会产生外部副作用的工具，并建立可持续执行的终极验收体系。

本阶段冻结以下原则：

1. 写操作必须先持久化 `prepared`，再执行副作用。
2. 写操作完成后必须生成可核验的 Receipt，模型只能消费已落盘结果。
3. 应用在任一关键边界崩溃后，不得盲目重复副作用。
4. Shell expansion 永远关闭；所有生产子进程必须经过 `SubprocessSupervisor`。
5. Journal 必须滚动并受磁盘配额约束。
6. 普通用户只看到任务进度和可理解的恢复状态；内部 ID、Receipt、Lease、Journal 与原始结果只在开发者诊断中按需加载。

## 2. 原子文件写工具

新增 `write_text_file`，只在绑定工作区的 Coding 模式中启用。

执行路径：

```text
resolve workspace boundary
→ validate target / sensitive path / symlink
→ compare expected SHA-256
→ write same-directory temporary file
→ fsync temporary file
→ atomic rename
→ sync parent directory where supported
→ verify final SHA-256
→ mark effect confirmed
→ store Receipt
→ report result
```

工具支持：

- SHA-256 内容证据；
- `expectedSha256` 乐观并发控制；
- 同内容调用不重写文件；
- 稳定 idempotency key；
- 崩溃后复用已经 fsync 的临时文件；
- Receipt 重放前重新核验实际文件；
- Receipt 与文件状态不一致时进入 `needs_reconciliation`；
- 工作区边界、敏感路径和符号链接保护；
- 单文件字节上限。

## 3. Receipt、verify 与 idempotency

`write_text_file` 的 Runtime Contract 为：

```text
effect: local_write
retryMode: idempotency_key
supportsAbort: true
supportsResume: true
verify: SHA-256 verification
reconcile: inspect actual target file
```

Receipt 的 `metadata.effectEvidence` 保存：

- 相对路径；
- 最终 SHA-256；
- 文件字节数；
- 是否使用原子替换。

重启后：

- Receipt 存在：先执行 `verify`，核验成功后重放，不再次写入；
- Receipt 不存在但同 call 处于 dispatched/effect_confirmed：通过同一 idempotency key 恢复到 prepared；
- 临时文件已 fsync：校验其 SHA-256 后继续 rename；
- 最终文件已经生效：写工具识别同内容并返回 idempotent replay，不改变 mtime；
- Receipt 已失效：禁止把旧结果继续报告给模型。

## 4. 写入崩溃窗口矩阵

`test:e2e:runtime-write-crash` 对每个关键边界启动独立 Worker，并使用真实 `process.exit(87)` 中断：

1. `after_prepare`
2. `after_dispatch`
3. `write:before_temp_write`
4. `write:after_temp_fsync`
5. `write:after_atomic_rename`
6. `write:after_hash_verify`
7. `after_effect`
8. `after_receipt`
9. `after_report`

恢复测试验证：

- 没有重复写入；
- 已生效文件 mtime 不变；
- fsync 后遗留的临时文件可以继续提交；
- 恢复后只存在一个有效 Receipt；
- unresolved count 回到 0；
- 不遗留 `.tmp` 文件。

## 5. Shell 与 Git 的统一进程监督

新增两个生产工具：

### `git_inspect`

- 只读 Git 子命令白名单；
- `shell: false`；
- 通过 `SubprocessSupervisor` 执行；
- 支持 timeout、AbortSignal、输出上限和进程树终止；
- 属于 read/safe 工具。

### `run_workspace_command`

- 仅允许显式 executable + args；
- 不接受命令字符串拼接；
- 不调用 shell；
- 可执行文件必须位于 allowlist；
- 通过 `SubprocessSupervisor` 执行；
- 属于 destructive/manual_only；
- 默认不向模型开放，只有开发者显式启用 `workspace.exec` 后可用。

回归测试会扫描 `electron/`：除 `SubprocessSupervisor.js` 外，生产代码不得直接导入 `node:child_process`。

## 6. Journal 滚动与磁盘治理

`DurableRuntimeJournal` 现在支持：

- 主 Journal + 编号归档；
- manifest；
- 单文件大小阈值；
- 最大归档数量；
- 最大总字节数；
- 跨归档按 sequence 恢复；
- 损坏行跳过；
- V1 → V2 迁移；
- Windows 原子 manifest 替换兼容；
- 开发者诊断中的 storage/loadReport/cursor；
- 独立的 `call-state/` 物化快照，确保旧 Journal 归档被配额回收后，未决工具调用仍可恢复。

默认值：

```text
单文件：8 MB
归档：6 个
总配额：48 MB
```

设置页开发者区域可以调整这些上限。

## 7. 真实 Electron 崩溃恢复 E2E

新增 `test:e2e:electron-runtime-crash`：

1. 启动真实 Electron 主进程；
2. `write_text_file` 完成 atomic rename 后立即 `process.exit(88)`；
3. 启动第二个真实 Electron 主进程；
4. 清理失联执行器 Lease；
5. 使用同一 callId 和内容恢复；
6. 验证文件没有再次写入；
7. 验证 Receipt 已生成且 unresolved count 为 0。

该测试在 GitHub Actions 的 Windows 与 Linux（Xvfb）上执行。

## 8. 性能基准与长期 Soak

### 快速 benchmark

`npm run test:benchmark` 默认执行：

- 10,000 条 Journal 追加；
- 多归档恢复；
- 100 次原子文件替换；
- 内存增量、吞吐率、磁盘配额断言。

本次容器实测：

```text
Journal append: 10,000 events / 5.64 s，约 1,773 events/s
Journal reload: 10,000 events / 0.47 s，约 21,474 events/s
Atomic writes: 100 / 0.21 s
Heap delta: 约 49 MB
```

以上数据用于回归基线，不是跨机器性能承诺。

### 长时间 Soak

`npm run test:soak` 默认运行 30 分钟，持续：

- 写入 Journal；
- 触发滚动与配额回收；
- 原子写入状态文件；
- 检查临时文件、内存和磁盘边界。

新增独立 GitHub Actions：

- 每周自动运行；
- 支持手动指定分钟数；
- 50 分钟 Job 超时保护。

## 9. UI 信息边界

### 普通用户可见

- Coding 模式中的自然语言写文件工具；
- 文件目标、成功或失败、执行耗时；
- Plan 和工具流；
- “需要核验 / 需要确认”的恢复提示；
- Recovery Center 的安全操作；
- 简洁的超时、冲突、权限与熔断提示。

### 开发者模式额外可见

- callId、runId、taskId；
- Runtime Contract；
- Receipt ID、checksum 和 effect evidence；
- Journal cursor、归档数量、字节数和 load report；
- Lease owner、heartbeat 与 expiresAt；
- Subprocess PID、命令、终止原因；
- 原始输入输出；
- Provider/Tool circuit breaker 诊断。

### 固定安全边界

开发者模式不会自动：

- 在 Chat 模式启用写工具；
- 允许工作区外写入；
- 关闭敏感文件或 symlink 保护；
- 开启任意 Shell；
- 开启任意 executable；
- 把 Runtime 内部数据发送到普通 Renderer 投影。

## 10. CI 验收

普通 Windows/Linux Core Job：

```text
lint
unit tests
build
read/remote crash recovery
atomic-write crash matrix
10,000-event benchmark
```

Windows/Linux Electron Job：

```text
real Electron crash recovery
Playwright Electron conversation E2E
```

独立周期任务：

```text
30-minute Runtime soak
```

## 11. 当前结论

第五阶段的代码实现和 Node 级验收已经完成。至此，最初五阶段 Tool Runtime 重构的功能范围已经全部落地：

- 核心状态与持久化；
- 人工恢复、熔断和子进程终止；
- 启动恢复与 Checkpoint；
- 增量 IPC 与 UI 信息分层；
- 真实写工具、崩溃矩阵、真实 Electron E2E、滚动配额和长期基准。

当前容器由于无法下载 Electron 二进制，真实 Electron E2E 未能在本地启动；测试代码已经加入 Windows/Linux GitHub Actions，最终跨平台验收以 CI 结果为准。
