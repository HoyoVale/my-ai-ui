# External Resource Security

Renderer 默认不得自动请求模型输出中的外部资源。

## Markdown

Conversation 与 Response 共用安全 Markdown 渲染器：

- 原始 HTML 通过 `skipHtml` 禁用；
- 远程 `http:` / `https:` 图片只显示占位卡片；
- 本地同源图片和受限 `data:image` / `blob:` 图片可以显示；
- 外部链接不会在 Electron 内导航；
- 点击外链后通过 IPC 交给主进程校验，再由系统浏览器打开；
- `file:`、`javascript:`、带凭据 URL、本地地址和私有网络地址被拒绝。

## Renderer session

主进程对默认 Session 施加统一限制：

- 只允许 Vite Renderer 自身 Origin 的 HTTP、HTTPS 和 HMR WebSocket 请求；
- 阻止所有其他 Renderer 网络请求；
- 拒绝权限申请；
- 阻止非可信页面导航；
- 拒绝创建新窗口。

模型 Provider SDK 在主进程中通过 Node 网络栈运行，不受 Renderer Session 策略影响。

## CSP

`index.html` 的 CSP 只允许同源脚本、样式、字体、图片和开发服务器连接，并明确禁止 iframe、object、base URL 和表单提交。
