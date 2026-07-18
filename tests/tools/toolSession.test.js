import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import {
  createAgentToolSession
} from "../../electron/tools/createAgentToolSession.js";

import {
  SAFE_TOOL_NAMES
} from "../../electron/tools/toolCatalog.js";

describe(
  "safe agent tool session",
  () => {
    it(
      "publishes the complete safe-core tool profile",
      () => {
        const session =
          createAgentToolSession({
            getAgentStatus: () => ({
              state: "running"
            })
          });

        assert.deepEqual(
          Object.keys(
            session.tools
          ).sort(),
          [...SAFE_TOOL_NAMES].sort()
        );
      }
    );

    it(
      "records completed tool executions and keeps a run plan",
      async () => {
        const records = [];
        const session =
          createAgentToolSession({
            getAgentStatus: () => ({
              state: "running"
            }),
            onRecord: (record) => {
              records.push(record);
            }
          });

        const result =
          await session.tools
            .update_plan
            .execute(
              {
                items: [
                  {
                    id: "step-1",
                    title:
                      "Inspect project",
                    status:
                      "in_progress"
                  }
                ]
              },
              {
                toolCallId:
                  "call-1"
              }
            );

        assert.equal(
          result.ok,
          true
        );
        assert.equal(
          session.getPlan()[0]
            .status,
          "in_progress"
        );
        assert.equal(
          session.getRecords()[0]
            .status,
          "complete"
        );
        assert.equal(
          records.some(
            (record) =>
              record.status ===
              "running"
          ),
          true
        );
      }
    );

    it(
      "stores a structured user question for the next turn",
      async () => {
        const session =
          createAgentToolSession();

        await session.tools.ask_user
          .execute(
            {
              question:
                "Which folder should I inspect?",
              options: [
                {
                  id: "src",
                  label: "src"
                }
              ]
            },
            {
              toolCallId:
                "call-question"
            }
          );

        assert.equal(
          session
            .getPendingQuestion()
            .question,
          "Which folder should I inspect?"
        );
      }
    );
  }
);
