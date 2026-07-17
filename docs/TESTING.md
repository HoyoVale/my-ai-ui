# 自动化测试分层

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

## 5. GitHub Actions

CI 分为三个独立 Job：

```text
Core
Electron smoke
Electron E2E
```

每个 Job 都分别在 Ubuntu 与 Windows 运行。E2E 失败截图会上传为 Actions artifact。
