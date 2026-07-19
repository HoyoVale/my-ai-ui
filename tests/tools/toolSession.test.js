import {
  afterEach,
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createAgentToolSession
} from "../../electron/tools/createAgentToolSession.js";

import {
  SAFE_TOOL_NAMES
} from "../../electron/tools/toolCatalog.js";

const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, {
      recursive: true,
      force: true
    });
  }
});

describe(
  "safe agent tool session",
  () => {
    it(
      "publishes read-only workspace tools for bound Chat and Coding sessions",
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

        const noWorkspaceSession =
          createAgentToolSession({
            getAgentStatus: () => ({
              state: "running"
            }),
            settings: {
              tools: {
                mode: "coding",
                workspace: {
                  roots: []
                },
                runtime: {},
                developer: {
                  toolsetOverrides: {},
                  toolOverrides: {}
                }
              }
            }
          });

        assert.equal(
          "get_workspace_info" in
            noWorkspaceSession.tools,
          false
        );
        assert.equal(
          "read_text_file" in
            noWorkspaceSession.tools,
          false
        );

        const root = fs.mkdtempSync(
          path.join(
            os.tmpdir(),
            "xixi-tool-session-"
          )
        );
        temporaryRoots.push(root);

        const chatWorkspaceSession =
          createAgentToolSession({
            getAgentStatus: () => ({
              state: "running"
            }),
            settings: {
              tools: {
                mode: "chat",
                workspace: {
                  roots: [root]
                },
                runtime: {},
                developer: {
                  toolsetOverrides: {},
                  toolOverrides: {}
                }
              }
            }
          });

        assert.equal(
          "read_text_file" in chatWorkspaceSession.tools,
          true
        );

        const codingSession =
          createAgentToolSession({
            getAgentStatus: () => ({
              state: "running"
            }),
            settings: {
              tools: {
                mode: "coding",
                workspace: {
                  roots: [root]
                },
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

  }
);
