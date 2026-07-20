import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  McpJournal,
  redactMcpLogChunk
} from "../../electron/mcp/McpJournal.js";

describe("MCP journal", () => {
  it("redacts credentials and filters user/developer/debug levels", () => {
    const journal = new McpJournal();
    journal.append("server", "connected", { level: "user" });
    journal.append("server", "callTool", { level: "developer" });
    journal.append("server", "raw protocol", { level: "debug" });

    assert.deepEqual(journal.list("server", { level: "user" }).map((row) => row.text), ["connected"]);
    assert.deepEqual(journal.list("server", { level: "developer" }).map((row) => row.text), ["connected", "callTool"]);
    assert.equal(journal.list("server", { level: "debug" }).length, 3);

    const redacted = redactMcpLogChunk(
      "Authorization: Bearer abcdef token=fixture-secret",
      ["fixture-secret"]
    );
    assert.equal(redacted.includes("abcdef"), false);
    assert.equal(redacted.includes("fixture-secret"), false);
    assert.match(redacted, /\[REDACTED\]/u);
  });
});
