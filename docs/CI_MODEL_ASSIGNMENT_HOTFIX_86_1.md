# 86.1 CI model-assignment hotfix

## Failure

Both Linux and Windows Electron E2E stopped at:

`Conversation model did not become e2e-model.`

## Root cause

The Model settings panel called `conversations.setModel(...)`, but the Setting-specific `useConversations()` hook did not expose that action. Selecting the model therefore raised a renderer `TypeError`; no `conversation-set-model` IPC request reached the main process.

## Fix

- The Model panel now invokes the existing preload `setConversationModel` API with the current conversation ID, provider ID, and model config ID.
- The E2E records Setting renderer errors and fails immediately with the original error.
- Model wait failures now include the last observed model ID.
- The regression contract prevents the removed hook method from being called again.

## Verification

- `npm test`: 670/670 passed
- `npm run lint`: passed
- `npm run build`: passed
- E2E script syntax and model-assignment contract: passed

The final Electron window run remains the responsibility of the GitHub Windows/Linux jobs because the local container does not provide `xvfb-run`.
