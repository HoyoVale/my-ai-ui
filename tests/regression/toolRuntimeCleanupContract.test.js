import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { sanitizeMessage } from "../../electron/conversation/conversationSchema.js";

function read(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(new URL(relativePath, import.meta.url));
}

describe("Tool Runtime cleanup contract", () => {
  it("removes obsolete interactive-question and forwarding modules", () => {
    assert.equal(exists("../../electron/agent/orchestration/askUserPolicy.js"), false);
    assert.equal(exists("../../electron/tools/agent/askUserPolicy.js"), false);
    assert.equal(exists("../../electron/tools/agent/agentTools.js"), false);
    assert.equal(exists("../../src/config/env.js"), false);
  });

  it("uses natural commentary without a progress tool", () => {
    const tools = read("../../electron/agent/orchestration/agentTools.js");
    const catalog = read("../../electron/tools/toolCatalog.js");
    const prompt = read("../../electron/context/baseSystemContext.js");

    assert.doesNotMatch(tools, /report_progress/u);
    assert.doesNotMatch(catalog, /report_progress/u);
    assert.match(prompt, /自然语言/u);
  });

  it("does not persist or render raw model reasoning", () => {
    const runtime = read("../../electron/agent/AgentRuntime.js");
    const schema = read("../../electron/conversation/conversationSchema.js");
    const panel = read("../../src/Conversation/components/TaskPanel.jsx");

    assert.doesNotMatch(runtime, /reasoningText|reasoningSummary/u);
    assert.doesNotMatch(schema, /reasoningSummary/u);
    assert.doesNotMatch(panel, /模型推理文本|reasoningText|reasoningSummary/u);
  });

  it("lets the Tool manifest alone control normal activity visibility", () => {
    for (const file of [
      "../../src/Conversation/components/MessageList.jsx",
      "../../src/Conversation/components/TaskPanel.jsx"
    ]) {
      const source = read(file);
      assert.match(source, /activityVisibility === "developer"/u);
      assert.doesNotMatch(source, /\[\s*"update_plan"|developerToolNames|hiddenToolNames/u);
    }
  });

  it("migrates legacy waiting questions to ordinary needs-input text and drops retired metadata", () => {
    const message = sanitizeMessage({
      id: "legacy-question",
      role: "assistant",
      content: "",
      status: "waiting",
      stopReason: "waiting_for_user",
      reasoningSummary: "private legacy reasoning",
      pendingQuestion: {
        question: "Which folder should be inspected?",
        status: "waiting"
      },
      createdAt: 100
    });

    assert.match(message.content, /Which folder should be inspected/u);
    assert.equal(message.status, "complete");
    assert.equal(message.stopReason, "needs_input");
    assert.equal(Object.hasOwn(message, "pendingQuestion"), false);
    assert.equal(Object.hasOwn(message, "reasoningSummary"), false);
  });
});
