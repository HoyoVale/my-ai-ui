# Core Lite 4.8 Final Text Limit Hotfix

## Problem

`CompletionEvidenceGate` scanned final responses through a 12,000-character window and accidentally returned that bounded scan value as the user-visible final response. Valid answers longer than 12,000 characters were therefore truncated after streaming completed.

## Fix

- Keep the 12,000-character bound only for claim/evidence scanning.
- Preserve the complete sanitized final response when evidence validation succeeds.
- Add a regression test that keeps a marker beyond character 12,500.

This does not remove model token limits or Tool output safety limits. It only separates evidence inspection bounds from user-visible final text.
