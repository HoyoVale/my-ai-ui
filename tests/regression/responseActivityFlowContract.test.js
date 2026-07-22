import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";
import fs from "node:fs";

import {
  hasResponseActivity
} from "../../src/Response/utils/responsePresentation.js";

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

  it("does not render a processing header for an ordinary reply without plan or tool activity", () => {
    assert.equal(
      hasResponseActivity({
        events: [],
        planStats: {
          total: 0
        }
      }),
      false
    );

    const response = read(
      "../../src/Response/Response.jsx"
    );
    const bubble = read(
      "../../src/Response/components/Bubble.jsx"
    );
    const flow = read(
      "../../src/Response/components/ActivityFlow.jsx"
    );

    assert.match(response, /hasResponseActivity/u);
    assert.match(bubble, /visible=\{hasActivity\}/u);
    assert.doesNotMatch(flow, /正在准备/u);
  });

  it("keeps the activity flow visible for a plan or a tool run", () => {
    assert.equal(
      hasResponseActivity({
        events: [
          {
            type: "tool"
          }
        ],
        planStats: {
          total: 0
        }
      }),
      true
    );

    assert.equal(
      hasResponseActivity({
        events: [],
        planStats: {
          total: 2
        }
      }),
      true
    );
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

  it("streams the tool-free step after tool execution as a provisional final answer", () => {
    const runtime = read(
      "../../electron/agent/AgentRuntime.js"
    );
    const presentation = read(
      "../../src/Response/utils/responsePresentation.js"
    );
    const conversation = read(
      "../../src/Conversation/components/MessageList.jsx"
    );

    assert.match(runtime, /inferLiveStepRole/u);
    assert.match(runtime, /liveStepRole/u);
    assert.match(presentation, /final_candidate/u);
    assert.match(conversation, /displayedFinalText/u);
  });

  it("streams finalization chunks into the structured final answer", () => {
    const runtime = read(
      "../../electron/agent/AgentRuntime.js"
    );

    assert.doesNotMatch(runtime, /bufferProgressHandoff/u);
    assert.match(runtime, /const publicStream = new PublicTextStreamSanitizer\(\);/u);
    assert.match(runtime, /const publicChunk = publicStream\.push\(textPart\);/u);
    assert.match(runtime, /this\.activeRun\.finalText = text;/u);
    assert.match(runtime, /appendResponseChunk\(publicChunk\);/u);
    assert.doesNotMatch(runtime, /appendResponseChunk\(textPart\);/u);
  });

});
