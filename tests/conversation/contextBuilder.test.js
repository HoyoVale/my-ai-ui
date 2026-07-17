import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import {
  buildShortTermContext,
  groupConversationTurns
} from "../../electron/conversation/contextBuilder.js";

function message(
  role,
  content,
  status = "complete"
) {
  return {
    role,
    content,
    status
  };
}

describe(
  "short-term context",
  () => {
    it(
      "keeps only the latest configured turns",
      () => {
        const result =
          buildShortTermContext({
            maxTurns: 2,

            messages: [
              message(
                "user",
                "u1"
              ),
              message(
                "assistant",
                "a1"
              ),
              message(
                "user",
                "u2"
              ),
              message(
                "assistant",
                "a2"
              ),
              message(
                "user",
                "u3"
              )
            ]
          });

        assert.deepEqual(
          result,
          [
            {
              role: "user",
              content: "u2"
            },
            {
              role:
                "assistant",
              content: "a2"
            },
            {
              role: "user",
              content: "u3"
            }
          ]
        );
      }
    );

    it(
      "excludes aborted assistant replies from future context",
      () => {
        const result =
          buildShortTermContext({
            maxTurns: 10,

            messages: [
              message(
                "user",
                "hello"
              ),
              message(
                "assistant",
                "partial",
                "aborted"
              ),
              message(
                "user",
                "continue"
              )
            ]
          });

        assert.deepEqual(
          result,
          [
            {
              role: "user",
              content: "hello"
            },
            {
              role: "user",
              content:
                "continue"
            }
          ]
        );
      }
    );

    it(
      "ignores orphan assistant messages",
      () => {
        assert.deepEqual(
          groupConversationTurns([
            message(
              "assistant",
              "orphan"
            ),
            message(
              "user",
              "question"
            ),
            message(
              "assistant",
              "answer"
            )
          ]),
          [
            [
              {
                role: "user",
                content:
                  "question"
              },
              {
                role:
                  "assistant",
                content: "answer"
              }
            ]
          ]
        );
      }
    );
  }
);
