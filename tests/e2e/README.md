# Playwright Electron E2E

运行：

```powershell
npm run test:e2e
```

测试会：

1. 在 `127.0.0.1:4173` 启动独立 Vite 服务；
2. 使用临时 Electron `userData` 目录；
3. 启用 `XIXI_E2E=1` 内置确定性测试模型；
4. 通过桌宠右键菜单打开 Input；
5. 连续发送两条消息；
6. 关闭第一次 Response 后验证第二次重新出现；
7. 打开独立会话窗口；
8. 新建会话并切换回原会话；
9. 验证四条完整消息仍然存在。

测试不会读取真实 API Key，也不会调用 DeepSeek。

## Short-term context path

The E2E flow also verifies:

- opening the Conversation context inspector
- saving a manual conversation summary
- pinning a message to the current conversation
- excluding another message from context
- reading the Token budget
- resetting recent context while preserving history
