import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import {
  getConversationTargetError,
  normalizeAgentMessageRequest
} from "../../electron/agent/messageTarget.js";

describe(
  "agent message target",
  () => {
    it(
      "normalizes the current structured Input request",
      () => {
        assert.deepEqual(
          normalizeAgentMessageRequest({
            content: " hello ",
            expectedConversationId: " session-coding ",
            continueTask: true
          }),
          {
            content: " hello ",
            expectedConversationId: "session-coding",
            continueTask: true
          }
        );
      }
    );

    it(
      "keeps legacy string callers compatible",
      () => {
        assert.deepEqual(
          normalizeAgentMessageRequest("hello"),
          {
            content: "hello",
            expectedConversationId: "",
            continueTask: false
          }
        );
      }
    );

    it(
      "rejects delivery when the selected Session changed",
      () => {
        assert.equal(
          getConversationTargetError(
            { id: "session-coding" },
            "session-coding"
          ),
          null
        );

        assert.deepEqual(
          getConversationTargetError(
            { id: "session-chat" },
            "session-coding"
          ),
          {
            ok: false,
            code: "conversation-changed",
            message:
              "当前会话已经切换，请确认会话后重新发送。"
          }
        );
      }
    );
  }
);
