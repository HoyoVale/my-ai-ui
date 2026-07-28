# Core Lite 4.8 RC Response window ownership hotfix

## Symptom

The real Electron release-candidate scenario accepted the long-stream request and
rendered the beginning marker, but after reloading and recreating the Response
window it could no longer observe:

```text
E2E_LONG_STREAM_END:e2e-long-stream-complete
```

## Root cause

A Response window can be destroyed while the Agent continues streaming. The next
chunk may create a replacement BrowserWindow before Electron dispatches the old
window's asynchronous `closed` callback.

The old callback previously reset shared controller state unconditionally. It
could therefore clear the replacement window reference, detach the replacement
Pet listeners, and redirect the remaining stream into another BrowserWindow.
The E2E page that saw the beginning of the stream then stopped receiving the
remaining chunks.

## Fix

- Capture each BrowserWindow instance inside its own loading and close callbacks.
- Only the BrowserWindow that still owns the controller may change `ready` or
  reset controller state.
- Ignore stale close callbacks after a replacement window has been claimed.
- Detach the previous Pet listeners before attaching a replacement window.
- Add a dependency-free ownership helper and deterministic regression contract.

The fix does not increase timeouts and does not weaken the release-candidate
assertion. The complete end marker must still be rendered and persisted.
