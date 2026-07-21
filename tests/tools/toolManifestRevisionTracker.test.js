import assert from "node:assert/strict";
import test from "node:test";

import {
  ToolManifestRevisionTracker
} from "../../electron/tools/capabilities/ToolManifestRevisionTracker.js";

test("tool manifest revision increments only when the semantic hash changes", () => {
  const tracker = new ToolManifestRevisionTracker();

  assert.deepEqual(tracker.observe("conversation-1", "a"), {
    revision: 1,
    hash: "a",
    changed: true
  });
  assert.deepEqual(tracker.observe("conversation-1", "a"), {
    revision: 1,
    hash: "a",
    changed: false
  });
  assert.deepEqual(tracker.observe("conversation-1", "b"), {
    revision: 2,
    hash: "b",
    changed: true
  });
  assert.deepEqual(tracker.observe("conversation-2", "b"), {
    revision: 1,
    hash: "b",
    changed: true
  });
});
