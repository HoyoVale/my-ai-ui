import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";
import fs from "node:fs";

function read(relativePath) {
  return fs.readFileSync(
    new URL(relativePath, import.meta.url),
    "utf8"
  );
}

describe("structured Response activity flow", () => {
  it("subscribes to Agent snapshots and keeps the last structured run after idle", () => {
    const source = read(
      "../../src/Response/hooks/useResponseStream.js"
    );

    assert.match(source, /onAgentStatusChanged/u);
    assert.match(source, /hasStructuredRun/u);
    assert.match(source, /status\.runId/u);
    assert.match(source, /setAgentStatus\(status\)/u);
  });

  it("separates commentary and tool activity from the final answer", () => {
    const response = read(
      "../../src/Response/Response.jsx"
    );
    const flow = read(
      "../../src/Response/components/ActivityFlow.jsx"
    );

    assert.match(response, /hasActivity/u);
    assert.match(response, /finalText/u);
    assert.match(response, /liveText/u);
    assert.match(flow, /event\.type === "commentary"/u);
    assert.match(flow, /event\.type === "tool_batch"/u);
    assert.match(flow, /getToolTitle/u);
    assert.match(flow, /createActivitySnapshot/u);
  });
  it("publishes the final structured snapshot before releasing the active run", () => {
    const runtime = read(
      "../../electron/agent/AgentRuntime.js"
    );

    assert.match(
      runtime,
      /this\.setStatus\(\{[\s\S]*runId,[\s\S]*endResponseStream\(\)/u
    );
  });

});
