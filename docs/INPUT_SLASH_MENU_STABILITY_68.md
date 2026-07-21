# Input Slash 菜单稳定性修复

## 问题

输入 `/` 后，Slash 菜单会测量自身高度并通知 Input 调整 Electron 窗口。旧实现从 `Input.jsx` 传入了每次渲染都会重新创建的内联高度回调；`SlashMenu` 的 `useLayoutEffect` 又把该回调作为依赖并立即写回高度，形成布局更新循环。

React 最终抛出 `Maximum update depth exceeded`，卸载 Input Renderer，因此表现为 Input 窗口突然消失，已有空白窗口再次打开也无法恢复。该问题与是否安装 Skill 无直接关系，在有 Skill、无 Skill、Skill Registry 读取失败时都可能发生。

## 修复

- Input 对 Context Menu 和 Slash Menu 使用稳定的 `useCallback` 高度处理器。
- 只有测量高度真正变化时才更新 React 状态。
- 两种菜单内部都记录最近一次已发布高度，ResizeObserver 重复回调不再反复写状态。
- 无 Skill、加载中、当前模式无兼容 Skill和读取失败继续显示明确状态。
- E2E 增加三次连续打开/关闭 `/` 菜单的回归验证，并检查 Input Renderer 始终可见。

## 边界

Slash 菜单不会因为没有 Skill 而关闭 Input，也不会发送 `/`。用户可按 Escape 关闭菜单，随后继续正常输入。
