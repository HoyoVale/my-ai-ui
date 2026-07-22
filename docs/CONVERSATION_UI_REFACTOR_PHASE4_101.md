# Conversation UI Refactor · Phase 4 / 101

## Scope

Phase 4 completes the core-structure roadmap by reorganizing the Conversation renderer and its large stylesheet. Runtime behavior, IPC contracts, persisted schemas, data projections, test ids, visible copy, and interaction semantics remain unchanged.

## Conversation shell

`src/Conversation/Conversation.jsx` is now a compact composition root. Panel state, active-run projection, root class derivation, context reset, workspace session creation, and mutually-exclusive panel routing live in:

- `src/Conversation/hooks/useConversationViewController.js`

The shell remains responsible for wiring shared hooks and rendering Sidebar, Topbar, MessageList, Plan, Platform, Approval, Task, Goal, and Context panels.

## Message surface

The former large MessageList component is separated into:

- `MessageList.jsx` — scrolling, live-follow behavior, message rendering, context actions, regeneration.
- `ActivityTimeline.jsx` — public commentary, Tool batches, inline command and Diff previews, live/final activity.
- `MessagePrimitives.jsx` — reusable message actions and empty states.

## Activity panel

The former large TaskPanel component is separated into:

- `TaskPanel.jsx` — snapshot selection, panel lifecycle, developer-detail loading, high-level composition.
- `TaskActivityTimeline.jsx` — public activity event rendering.
- `DeveloperActivityPanel.jsx` — internal plan, identifiers, raw Tool details, Runtime diagnostics.
- `taskPanelModel.js` — visibility and plan-status projection helpers.

## CSS ownership

`Conversation.css` is now an ordered import manifest. The original cascade order is retained across:

1. `shell.css`
2. `messages.css`
3. `task-panel.css`
4. `activity.css`
5. `navigation.css`
6. `plan-goal.css`
7. `platform.css`
8. `approval.css`
9. `responsive.css`
10. `diff-command.css`

No selector was renamed and no declaration was reordered relative to the original 5,742-line stylesheet.

## Test architecture

Legacy source-contract tests now read the full logical Conversation surface through `tests/helpers/conversationUiSource.js`. This avoids forcing future implementations back into `MessageList.jsx`, `TaskPanel.jsx`, or one monolithic CSS file.

New command:

```powershell
npm run test:phase4-conversation-ui
```

The Phase 4 architecture contract verifies compact facades, single responsibility ownership, ordered style imports, and absence of child-to-facade circular imports.

## Validation

Completed in the delivery environment:

- Phase 4 UI suite: 33/33 passed.
- Conversation-related legacy contracts: 88/88 passed.
- Phase 3 Core Runtime suite: passed.
- Phase 2 AgentRuntime suite: 25/25 passed.
- Phase 1 Execution Consistency suite: 39/39 passed.
- TypeScript parser/no-unused static pass for all changed production JS/JSX files.
- CSS brace balance for every split stylesheet.

A complete `npm test` was attempted. Tests unrelated to Phase 4 that require complete `ai`/Provider dependencies could not load in the container's partial dependency fixture; 645 tests passed before/alongside those dependency-load failures. This is an environment limitation, not a claimed full-suite pass.

Run locally after applying the overlay:

```powershell
npm run test:phase4-conversation-ui
npm run check:full
```
