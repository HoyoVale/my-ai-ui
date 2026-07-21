# Input Overlay Stability Fix 68.2

## Scope

This maintenance patch stabilizes the two Input overlays:

- the `+` context menu;
- the `/skill-id` suggestion menu.

It is designed for a project that already contains both the 68 maintenance patch and the first Slash-menu stability patch.

## Root cause

Opening the Slash menu increments `contextMenuCloseToken` to request that an already-open context menu close. The context menu previously interpreted every value greater than zero as a permanent close state:

```text
Slash opened once
→ closeToken becomes 1
→ every later + menu open sees closeToken > 0
→ + menu immediately closes itself
```

A second interaction problem reset Slash suppression whenever the `+` menu closed. When `/` remained in the input, the Slash menu could immediately reopen and compete with the context menu.

## Fix

- Treat `closeToken` as an edge-triggered event and consume each value only once.
- Consume close events even while the context menu is closed, so stale events cannot poison future opens.
- Keep Slash suppressed after the context menu closes until the user edits the input again.
- Preserve the existing measured-height de-duplication for both overlays.
- Add Electron E2E coverage that opens the `+` menu repeatedly after Slash has been opened.

## Validation

The renderer was exercised with:

- an available Skill;
- no installed Skills;
- a failed Skill Registry read;
- repeated `+` open/close cycles;
- repeated Slash open/close cycles;
- opening `+` while Slash is active;
- opening Slash while `+` is active;
- all context-menu subpages;
- outside-click and Escape dismissal.

The full Node test suite, lint, production build, runtime crash recovery, atomic-write crash matrix, benchmark, short soak, dependency audit, and Electron/CJS syntax checks also pass.
