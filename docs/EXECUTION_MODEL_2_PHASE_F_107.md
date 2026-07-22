# Execution Model 2.0 — Phase F Minimal User UI & Developer Diagnostics

## 1. Goal

Phase F applies a Codex-style presentation rule:

> Ordinary users see the task, progress, required intervention, tool results, and final changes. Developers can inspect the runtime model.

This phase does not add a Thread manager, Run browser, Platform graph, or routing control surface to the normal Conversation UI.

## 2. User-facing task states

The Conversation UI now projects the existing runtime into a bounded vocabulary:

```text
working
continuable
completed
failed
cancelled
```

Natural-language labels include:

```text
正在处理
正在停止
任务已中断
任务可以继续
处理遇到问题
任务已取消
处理完成
```

The normal UI no longer describes the activity surface as a reasoning or thinking trace.

## 3. Shared tool cards

The message timeline and the task details panel now share one component:

```text
ToolActivityCard
```

It selects one of three public presentations:

```text
Command tool  → command card and terminal output
File mutation → changed-files card and unified diff
Other tool    → concise target and bounded tool reply
```

Raw inputs, raw results, runtime contracts, receipts, and model output remain in `DeveloperActivityPanel`.

## 4. Command presentation

A command card displays:

- a terminal icon;
- the exact display command;
- running, success, termination, or exit-code state;
- the bounded public tool reply;
- expandable stdout and stderr;
- truncation messaging appropriate to the current mode.

Expansion policy:

```text
running / failed / attention → open
successful historical command → collapsed
```

The working directory and Tool Receipt wording are only shown when developer metadata is enabled.

## 5. Diff presentation

A file-change card displays:

- changed-file label;
- bounded tool reply or path summary;
- added and removed line totals;
- expandable per-file unified diff;
- truncation notice without exposing Receipt internals.

The final baseline-to-workspace diff is now a single collapsed `文件改动` card. It shows file and line totals first, then expands into individual files.

## 6. Long-task progress

The historical activity row is collapsed by default. A live run remains expanded and displays:

- public commentary;
- command cards;
- diff cards;
- generic tool replies;
- user-visible failures;
- streamed step text.

Developer mode adds one `查看开发者详情` entry instead of mixing identifiers and runtime diagnostics into the public timeline.

## 7. Developer isolation

Normal tool cards do not render:

```text
Thread ID
Run ID
Routing Decision
Provider Continuation
Platform child Thread
Tool Input JSON
Tool Result JSON
Runtime Contract
Model Output
Tool Receipt
```

The existing developer activity panel continues to provide raw data on demand and now explicitly enables command metadata.

## 8. New modules

```text
src/Conversation/components/ToolActivityCard.jsx
src/Conversation/components/toolActivityModel.js
src/Conversation/components/userTaskViewModel.js
src/Conversation/styles/tool-cards.css
```

Updated components:

```text
ActivityTimeline.jsx
TaskActivityTimeline.jsx
TaskPanel.jsx
CommandOutput.jsx
FileDiff.jsx
DeveloperActivityPanel.jsx
Icon.jsx
```

## 9. Runtime and data boundaries

Phase F does not change:

- Conversation Store v23;
- Platform snapshot v6;
- AgentRuntime;
- Thread Router authority;
- Steering activation;
- Tool execution;
- Tool Result persistence;
- Diff generation;
- Platform Task Graph;
- Completion Authority;
- Provider requests.

It is a UI projection and interaction change only.

## 10. Test command

```powershell
npm run test:phaseF-conversation-ui
```

The Phase F test suite verifies:

- command, diff, and generic tool projection;
- bounded user task states;
- one shared tool-card implementation;
- normal/developer data separation;
- removal of thinking-language from the public surface;
- final diff collapse;
- stylesheet ordering;
- Phase 4 architecture compatibility;
- live activity, Diff, developer-mode, and activity-panel regressions.
