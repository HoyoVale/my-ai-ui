import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { McpJournal } from "../../electron/mcp/McpJournal.js";
import { McpToolManifestTracker } from "../../electron/mcp/McpToolManifestTracker.js";

describe("MCP tool manifest tracker", () => {
  it("increments revisions only when the normalized toolset changes", () => {
    const journal = new McpJournal();
    const tracker = new McpToolManifestTracker({ journal });
    const first = tracker.update("server", [{
      name: "read",
      description: "Read",
      inputSchema: { type: "object" }
    }]);
    const identical = tracker.update("server", [{
      name: "read",
      description: "Read",
      inputSchema: { type: "object" }
    }]);
    const changed = tracker.update("server", [{
      name: "read_v2",
      description: "Read",
      inputSchema: { type: "object" }
    }]);

    assert.equal(first.revision, 1);
    assert.equal(identical.revision, 1);
    assert.equal(identical.changed, false);
    assert.equal(changed.revision, 2);
    assert.equal(
      journal.list("server").filter((entry) => entry.event === "MCP_TOOLSET_CHANGED").length,
      2
    );
  });
});
