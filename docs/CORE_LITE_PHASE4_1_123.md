# Core Lite 4.1 — Final response streaming

## Goal

Display the independent finalization answer token by token after Tool activity while keeping the completion-evidence gate authoritative over the text that is persisted as final.

## Runtime flow

```text
AI SDK finalization textStream
→ PublicTextStreamSanitizer
→ FinalResponseStream.append()
→ Response chunk IPC + structured finalText patch
→ completion evidence reconciliation
→ FinalResponseStream.commit()
→ no-op when unchanged, atomic replace when corrected
→ persist final assistant message
```

## Replacement channel

The legacy Response text stream was append-only. Core Lite 4.1 adds `response-stream-replace` so a retry or evidence correction replaces provisional text instead of appending a duplicate answer.

The structured Agent status remains authoritative for Conversation and Response rendering. The legacy stream remains a fallback for renderer startup races.

## Retry and cancellation

- Every finalization attempt resets the provisional final text.
- A failed attempt cannot be concatenated with the next attempt.
- Cancellation preserves the visible partial final answer when `saveAbortedReplies` is enabled.
- Evidence reconciliation may replace unsupported success claims before persistence.

## Verification

```powershell
npm run test:core-lite4.1
npm run check:full
```
