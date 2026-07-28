import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isExpectedSkillSubscriberDisconnect,
  reportSkillNotifyError
} from "../../electron/skills/SkillNotification.js";

describe("Skill notification errors", () => {
  it("silently ignores a closed Renderer subscriber", () => {
    const calls = [];
    const error = new Error("renderer closed");
    assert.equal(isExpectedSkillSubscriberDisconnect(error), true);
    const result = reportSkillNotifyError(error, {
      warn: (...args) => calls.push(args)
    });
    assert.deepEqual(result, { ignored: true, reported: false });
    assert.equal(calls.length, 0);
  });

  it("still reports unexpected broadcast failures", () => {
    const calls = [];
    const error = new Error("unexpected listener bug");
    const result = reportSkillNotifyError(error, {
      warn: (...args) => calls.push(args)
    });
    assert.deepEqual(result, { ignored: false, reported: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], error);
  });
});
