import {
  readConversationShellSource
} from "../helpers/conversationUiSource.js";

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  createActivitySnapshot
} from "../../src/Conversation/utils/taskActivity.js";

test("Runtime recovery evidence remains internal while the obsolete global UI is removed", () => {
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
  assert.equal(snapshot.runtimeDiagnostics.calls[0].idempotencyKey, "private-key");

  const conversation = readConversationShellSource();
  const topbar = fs.readFileSync(
    new URL("../../src/Conversation/components/Topbar.jsx", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(conversation, /ConversationRecoveryPanel/u);
  assert.doesNotMatch(topbar, /conversation-recovery-toggle/u);
});
