# Core Lite 3.6 P1

This phase physically removes the dormant Platform, Multi-Agent, Long-running Agent, Integration Coordinator and Worktree Agent platform. It also removes their crash fixtures, tests, npm scripts, CI steps and Worker runtime settings.

The Coding process foundation remains available through `SubprocessSupervisor`; only the autonomous Platform control plane is removed.

The production runtime is now limited to the direct Core Lite lifecycle:

```text
AgentRuntime
→ AgentRunSession
→ CoreLiteRunLoop
→ Tool Runtime / MCP / Skill / Memory
→ final response or checkpoint
```

`npm run verify:core-lite-tree` rejects any reintroduced `electron/platform` directory, Platform test suites, retired crash scripts or Worker runtime settings.
