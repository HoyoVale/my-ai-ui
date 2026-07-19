import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  resolveActiveRunText
} from "../../electron/agent/activeRunText.js";

describe("resolveActiveRunText", () => {
  it("prefers a completed final response", () => {
    assert.equal(
      resolveActiveRunText({
        finalText: "final",
        currentStepText: "live"
      }),
      "final"
    );
  });

  it("falls back to the visible live stream while final text is empty", () => {
    assert.equal(
      resolveActiveRunText({
        finalText: "",
        currentStepText: "partial response"
      }),
      "partial response"
    );
    assert.equal(
      resolveActiveRunText({
        finalText: "   ",
        currentStepText: "partial response"
      }),
      "partial response"
    );
  });

  it("can trim the selected text for cancelled partial replies", () => {
    assert.equal(
      resolveActiveRunText(
        {
          finalText: "",
          currentStepText: "  partial response  "
        },
        { trim: true }
      ),
      "partial response"
    );
  });
});
