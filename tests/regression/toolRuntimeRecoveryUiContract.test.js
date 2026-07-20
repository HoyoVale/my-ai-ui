import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  createActivitySnapshot
} from "../../src/Conversation/utils/taskActivity.js";

test("ordinary activity exposes recovery guidance while developer UI keeps diagnostics", () => {
  const snapshot = createActivitySnapshot({
    runId: "run-1",
    state: "idle",
    toolRuntime: {
      unresolvedCount: 1,
      needsConfirmation: 1,
      needsReconciliation: 0
    },
    toolRuntimeDiagnostics: {
      calls: [{ callId: "call-1", idempotencyKey: "private-key" }]
    },
    activity: {
      runId: "run-1",
      status: "interrupted",
      events: []
    }
  }, { live: true });

  assert.equal(snapshot.runtimeRecovery.needsConfirmation, 1);
  assert.equal(
    snapshot.runtimeDiagnostics.calls[0].idempotencyKey,
    "private-key"
  );

  const panel = fs.readFileSync(
    new URL("../../src/Conversation/components/TaskPanel.jsx", import.meta.url),
    "utf8"
  );
  assert.match(panel, /data-testid="tool-runtime-recovery"/);
  assert.match(panel, /Runtime state/);
  assert.match(panel, /Runtime contract/);
});


test("global recovery history is developer-only while task recovery remains available", () => {
  const conversation = fs.readFileSync(
    new URL("../../src/Conversation/Conversation.jsx", import.meta.url),
    "utf8"
  );
  const topbar = fs.readFileSync(
    new URL("../../src/Conversation/components/Topbar.jsx", import.meta.url),
    "utf8"
  );
  const recoveryPanel = fs.readFileSync(
    new URL("../../src/Conversation/components/RecoveryPanel.jsx", import.meta.url),
    "utf8"
  );
  const runtime = fs.readFileSync(
    new URL("../../electron/agent/AgentRuntime.js", import.meta.url),
    "utf8"
  );

  assert.match(conversation, /showRecovery=\{developerMode\}/u);
  assert.match(conversation, /if \(!developerMode\)/u);
  assert.match(topbar, /showRecovery &&/u);
  assert.match(recoveryPanel, /!open \|\| !developerMode/u);
  assert.match(runtime, /恢复中心仅在开发者模式下可用/u);
  assert.match(conversation, /getToolRuntimeRecovery/u);
});
