# Core Lite 4.8 RC send-state hotfix

## Problem

The Electron release-candidate E2E waited for `aria-label=Stop`, while the accessible label exposed by the Composer is `Stop generation`. The run started normally, but the test timed out on a stale presentation-string assertion.

## Fix

- Add `data-run-state=idle|running|stopping` to the Composer send button.
- Make the RC E2E wait for the stable run-state contract.
- Verify that the input value is cleared before treating the send action as accepted.
- Do not require observing the transient running state for the short final-check response.

No Runtime production behavior or accessibility label was changed.
