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

describe("Core Lite final response streaming", () => {
  it("streams public finalization chunks before reconciliation completes", () => {
    const source = read(
      "../../electron/agent/finalization/AgentRunFinalization.js"
    );

    assert.match(source, /new FinalResponseStream/u);
    assert.match(
      source,
      /for await \(const textPart of result\.textStream\)[\s\S]*finalStream\.append\(publicChunk\)/u
    );
    assert.match(
      source,
      /reconcileFinalResponse\([\s\S]*finalStream\.commit\(publicText\)/u
    );
    assert.doesNotMatch(source, /appendResponseChunk\(publicText\)/u);
  });

  it("supports authoritative replacement when verified text changes", () => {
    const channels = read(
      "../../electron/shared/ipcChannels.cjs"
    );
    const preload = read(
      "../../electron/preload/preload.cjs"
    );
    const controller = read(
      "../../electron/windows/response/ResponseWindowController.js"
    );
    const hook = read(
      "../../src/Response/hooks/useResponseStream.js"
    );

    assert.match(channels, /response-stream-replace/u);
    assert.match(preload, /onResponseReplace/u);
    assert.match(controller, /replaceText\(value\)/u);
    assert.match(controller, /STREAM_REPLACE/u);
    assert.match(hook, /onResponseReplace/u);
    assert.match(hook, /setText\(String\(value \?\? ""\)\)/u);
  });

  it("publishes incremental structured finalText updates", () => {
    const source = read(
      "../../electron/agent/finalization/AgentRunFinalization.js"
    );

    assert.match(
      source,
      /onText: \(text\) => \{[\s\S]*this\.activeRun\.finalText = text;[\s\S]*this\.setStatus/u
    );
  });
});
