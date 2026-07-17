# 自动化测试分层

## 第一层：纯逻辑与回归测试

命令：

```powershell
npm test
```

使用 Node.js 自带的 `node:test`，不增加测试框架依赖。

覆盖：

- 设置校验
- 会话存储
- 会话管理
- 短期上下文裁剪
- Input 高度回归
- Response 再次唤出契约
- IPC 频道契约

这层应当保持快速，适合每次修改后运行。

## 第二层：构建检查

命令：

```powershell
npm run check
```

执行：

```text
oxlint
node --test
vite build
```

任何一项失败都应阻止合并代码。

## 第三层：Electron preload 冒烟测试

命令：

```powershell
npm run test:electron
```

测试会启动一个隐藏 BrowserWindow，确认：

- preload 成功执行
- `window.api` 已注入
- 关键方法存在
- send / invoke IPC 可以往返

这层专门防止 preload 拆分、频道改名或 contextBridge 修改后导致全部窗口通信失效。

## 第四层：Electron UI E2E（后续）

后续引入 Playwright Electron 测试，覆盖：

- Pet 拖动
- 右键菜单
- Input 输入、发送、停止
- Response 首次与再次唤出
- Setting 修改后实时生效
- 会话切换与短期上下文

UI E2E 比纯逻辑测试慢，应只保留关键用户路径。
