import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeAskUserRequest,
  OTHER_OPTION_ID
} from "../../electron/tools/agent/askUserPolicy.js";

describe("ask_user system other answer", () => {
  it("enables the fixed other answer by default", () => {
    const request = normalizeAskUserRequest({
      question: "Choose",
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B" }
      ]
    });

    assert.equal(request.allowOther, true);
    assert.equal(
      request.options.some((item) => item.id === OTHER_OPTION_ID),
      false
    );
  });

  it("removes model-generated duplicate other options", () => {
    const request = normalizeAskUserRequest({
      question: "Choose",
      options: [
        { id: "a", label: "A" },
        { id: OTHER_OPTION_ID, label: "其它回答" },
        { id: "custom", label: "其他" }
      ]
    });

    assert.deepEqual(request.options.map((item) => item.id), ["a"]);
    assert.equal(request.allowOther, true);
  });

  it("honors strict fixed-choice questions", () => {
    const request = normalizeAskUserRequest({
      question: "Approve?",
      options: [{ id: "yes", label: "Yes" }],
      allowOther: false
    });

    assert.equal(request.allowOther, false);
  });
});
