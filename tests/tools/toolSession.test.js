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
      "publishes Chat tools by default and Coding tools when selected",
      () => {
        const chatSession =
          createAgentToolSession({
            getAgentStatus: () => ({
              state: "running"
            })
          });

        assert.equal(
          "read_text_file" in
            chatSession.tools,
          false
        );

        const codingSession =
          createAgentToolSession({
            getAgentStatus: () => ({
              state: "running"
            }),
            settings: {
              tools: {
                mode: "coding",
                workspace: {},
                runtime: {},
                developer: {
                  toolsetOverrides: {},
                  toolOverrides: {}
                }
              }
            }
          });

        assert.deepEqual(
          Object.keys(
            codingSession.tools
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
          "completed"
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

    it("does not expose the retired ask_user tool", () => {
      const session = createAgentToolSession();

      assert.equal("ask_user" in session.tools, false);
      assert.equal(
        session.registryManifest.some((tool) => tool.name === "ask_user"),
        false
      );
    });
  }
);
