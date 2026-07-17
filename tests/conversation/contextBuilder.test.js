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
                id: null,
                role: "user",
                content:
                  "question"
              },
              {
                id: null,
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

import {
  buildPinnedConversationContext,
  selectShortTermContextMessages
} from "../../electron/conversation/contextBuilder.js";

describe(
  "managed short-term context",
  () => {
    it(
      "respects reset boundaries and excluded messages",
      () => {
        const messages = [
          {
            id: "m1",
            role: "user",
            content: "before",
            status: "complete",
            includeInContext: true
          },
          {
            id: "m2",
            role: "assistant",
            content: "before reply",
            status: "complete",
            includeInContext: true
          },
          {
            id: "m3",
            role: "user",
            content: "excluded",
            status: "complete",
            includeInContext: false
          },
          {
            id: "m4",
            role: "user",
            content: "after",
            status: "complete",
            includeInContext: true
          }
        ];

        assert.deepEqual(
          selectShortTermContextMessages({
            messages,
            maxTurns: 8,
            contextStartAfterMessageId: "m2"
          }),
          [
            {
              id: "m4",
              role: "user",
              content: "after"
            }
          ]
        );
      }
    );

    it(
      "builds pinned system context separately",
      () => {
        assert.match(
          buildPinnedConversationContext([
            {
              id: "m1",
              role: "user",
              content: "keep this",
              status: "complete",
              includeInContext: true,
              pinnedToContext: true
            }
          ]),
          /keep this/
        );
      }
    );
  }
);
