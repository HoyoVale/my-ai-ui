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
import { z } from "zod";

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

        assert.equal(
          "write_text_file" in codingSession.tools,
          true
        );
        assert.equal(
          "write_text_file" in chatWorkspaceSession.tools,
          false
        );
        assert.equal(
          "git_inspect" in codingSession.tools,
          true
        );
        assert.equal(
          "run_project_script" in codingSession.tools,
          true
        );
        assert.equal(
          "run_workspace_command" in codingSession.tools,
          false
        );

        const expectedDefaultTools = SAFE_TOOL_NAMES.filter(
          (name) => name !== "run_workspace_command"
        );
        assert.deepEqual(
          Object.keys(codingSession.tools).sort(),
          expectedDefaultTools.sort()
        );

        const developerSession = createAgentToolSession({
          getAgentStatus: () => ({ state: "running" }),
          settings: {
            tools: {
              mode: "coding",
              workspace: { roots: [root], allowedCommands: ["node"] },
              runtime: {},
              developer: {
                toolsetOverrides: {
                  "workspace.exec": "enabled"
                },
                toolOverrides: {}
              }
            }
          }
        });
        assert.equal("git_inspect" in developerSession.tools, true);
        assert.equal("run_workspace_command" in developerSession.tools, true);
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

    it(
      "pauses an external write until the approval policy resolves",
      async () => {
        let executed = false;
        let approvalRequest = null;
        let resolveApproval = null;
        const externalTool = {
          id: "mcp.fixture.write@1",
          name: "mcp_fixture_write",
          version: 1,
          title: "Remote write",
          description: "Test write",
          source: "mcp.fixture",
          toolsets: ["mcp.fixture"],
          inputSchema: z.object({ value: z.string() }),
          sideEffect: "external",
          riskLevel: "medium",
          runtimeContract: {
            effect: "remote_write",
            retryMode: "manual_only",
            supportsAbort: true,
            supportsResume: false
          },
          retryPolicy: { maxAttempts: 1, retryOn: [], backoffMs: 0 },
          async execute(input) {
            executed = true;
            return { ok: true, data: input };
          }
        };
        const session = createAgentToolSession({
          externalDefinitions: [externalTool],
          getAgentStatus: () => ({ state: "running" }),
          authorizeTool: (request) => {
            if (request.definition.runtimeContract.effect !== "remote_write") {
              return { decision: "allow" };
            }
            approvalRequest = request;
            return new Promise((resolve) => {
              resolveApproval = resolve;
            });
          }
        });

        await session.tools.update_plan.execute({
          items: [{ id: "step-1", title: "Write remote value", status: "in_progress" }]
        }, { toolCallId: "plan-call" });

        const execution = session.tools.mcp_fixture_write.execute(
          { value: "approved" },
          { toolCallId: "write-call" }
        );
        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(executed, false);
        assert.equal(approvalRequest.definition.runtimeContract.effect, "remote_write");
        resolveApproval({ decision: "allow" });
        const result = await execution;
        assert.equal(result.ok, true);
        assert.equal(executed, true);
        await session.closePersistence();
      }
    );

  }
);
