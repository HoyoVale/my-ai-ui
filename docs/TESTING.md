# Testing

## Stable Core Lite checks

```powershell
npm run verify:core-lite-tree
npm run test:core-lite
npm run test:core-lite4.1
npm run test:core-lite4.2
npm run test:core-lite4.3
npm run test:core-lite4.4
npm run test:core-lite4.5
npm run test:core-lite4.6
npm run test:core-lite4.7
npm run test:core-lite4.8
npm run test:stress:core-lite4.8
npm run test:e2e:electron-rc
npm run report:core-lite4.8
npm run check
npm run check:full
```

`test:core-lite` is the stable architecture contract. `test:core-lite4.1` covers incremental final-response delivery and authoritative replacement. `test:core-lite4.2` covers idempotent stop requests, model/Tool/approval cancellation, partial-reply persistence, cancellation recovery and terminal-state consistency. `test:core-lite4.3` covers Provider/Tool error classification, safe retry gates, backoff, circuit breakers and Skill subscriber disconnects. `test:core-lite4.4` covers checkpoint validation, Tool receipt reconciliation, model/workspace binding and partial-output recovery. `test:core-lite4.5` covers the single terminal presentation shared by Response, Conversation, recovery and persistence. `test:core-lite4.6` covers single-owner terminalization, bounded resource cleanup, shutdown ordering, Renderer close races and supervised subprocess release. `test:core-lite4.7` adds deterministic in-process fault injection. `test:core-lite4.8` verifies the real Electron release harness, long-stream listener cleanup and report contracts. `test:stress:core-lite4.8` is the short CI pressure gate; `test:soak:core-lite4.8` is the explicit thirty-minute local soak. Historical phase-numbered
test scripts have been removed so deleted Goal, Plan, Execution and Platform
implementations cannot become an accidental test dependency.

## 1. 纯逻辑与回归

```powershell
npm test
```

使用 Node `node:test`，覆盖会话、上下文、设置、IPC 契约和历史 Bug。

## 2. Core 检查

```powershell
npm run check
```

依次执行：

```text
oxlint
node --test
vite build
```

## 3. Electron preload 冒烟

本地 Windows：

```powershell
npm run test:electron
```

Linux CI：

```powershell
npm run test:electron:ci
```

Linux CI 版本仅在测试进程中添加 `--no-sandbox`，解决 GitHub Runner 的 SUID sandbox 权限问题。正式应用不关闭 sandbox。

## 4. Playwright Electron E2E

```powershell
npm run test:e2e
```

测试使用 Playwright `_electron.launch()` 启动真实 Electron 应用，并使用临时：

```text
userData
Vite 端口 4173
确定性 E2E Agent
```

当前验证：

- 桌宠右键菜单打开 Input
- 连续发送两条消息
- 第二条回复包含两轮短期上下文
- Response 关闭后再次唤出
- 打开独立会话窗口
- 新建与切换会话
- 完整历史消息仍然存在
- 手动添加 v3 长期记忆（标题、描述、标签和优先级）
- 在新会话中验证记忆注入
- 配置并切换同一 Provider 下的模型
- 验证 Conversation 与 Response 的 LaTeX 渲染
- 停用记忆后验证不再注入

## 4.7 生命周期压力与故障注入

快速确定性测试：

```powershell
npm run test:core-lite4.7
```

三秒 CI 压力门槛：

```powershell
npm run test:stress:core-lite4.7
```

十分钟本地 soak：

```powershell
npm run test:soak:core-lite4.7
```

覆盖并发终态所有权、Renderer 反复重载、异步广播失败、持久化永久挂起、Abort 监听竞态和重复子进程终止。长时间 soak 不放入普通 `npm test`，避免日常开发与 Pull Request 被无意义拖长。


## 4.8 真实 Electron 发布候选门槛

```powershell
npm run test:core-lite4.8
npm run test:e2e:electron-rc
```

真实 Electron 用例在同一个临时 `userData` 上验证：

- 多秒最终回复持续流式输出；
- Response reload 后从主进程快照恢复；
- Response 与 Conversation BrowserWindow 销毁后只重建一个实例；
- 正常退出后完整回答仍存在；
- 生成中退出后重启为 cancelled、不可继续的终态；
- 重启后新 Run 不受旧监听器或旧窗口影响。

报告写入：

```text
test-results/core-lite-4.8/
```

CI 总结 Job 会下载 Windows/Linux 两侧的生命周期和 Electron 报告，并执行：

```powershell
node scripts/create-release-candidate-summary.mjs --require-platforms=linux,win32
```

本地 `npm run check:full` 完成后会运行 `npm run report:core-lite4.8`，要求当前平台的两类报告都已通过。

## 5. GitHub Actions

CI 分为三个独立 Job：

```text
Core
Electron smoke
Electron E2E
```

前三个 Job 分别在 Ubuntu 与 Windows 运行；第四个 Job 聚合两侧报告并生成发布候选汇总。E2E 诊断、截图、压力报告和最终 summary 都会上传为 Actions artifact。

## Personality 与 ContextAssembler

新增测试覆盖：

- Personality 设置清理与枚举回退
- 人格提示词生成
- 基础规则、人格和长期记忆的固定组装顺序
- Personality 或 Memory 关闭后不加入系统上下文
- E2E 测试模型读取 ContextAssembler 元数据
- Playwright 从 Setting 修改人格，再在新会话中验证生效

## 6. Tool Runtime 故障恢复测试

Tool Runtime 重构增加以下 Node 测试类别：

- Tool Call 状态机不变量；
- Journal 截断恢复；
- Receipt 持久化和重启重放；
- 不确定远程写入的 reconciliation；
- Runtime Checkpoint；
- Checkpoint 工作区与模型身份校验；
- 未决 Tool Receipt 阻止自动续跑；
- 部分回复在崩溃恢复后的还原；
- 未来版本和不可恢复检查点的拒绝；
- 普通/开发者状态投影；
- 状态广播合并；
- Activity/Event 有界投影；
- 大结果目录配额。

真实崩溃注入 E2E 应在可运行 Electron 的 CI 环境中执行。测试必须验证“无重复副作用”，而不只是验证界面最终出现成功文案。
## 4.9 packaging and release contracts

Run the dependency-free packaging contract before attempting a signed build:

```powershell
npm run test:core-lite4.9
```

It verifies packaged renderer routing, updater state/IPC, version and lockfile
identity, electron-builder targets, fail-closed signing rules, manifest hashes,
platform update metadata and the GitHub Release workflow. It does not replace a
real signed build. Formal tag releases must still pass platform-native
Authenticode, codesign, Gatekeeper and notarization/stapling checks in CI.

A local packaging rehearsal uses:

```powershell
npm run release:validate
npm run release:bootstrap
npm run release:package:win
npm run release:verify-artifacts -- --platform=win32 --directory=release/win32
```

Unsigned manual workflow runs are artifact-only dry runs and cannot enter the
GitHub Release publishing job.
