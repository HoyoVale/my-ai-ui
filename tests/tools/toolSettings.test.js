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
  ToolExecutor
} from "../../electron/tools/core/ToolExecutor.js";

import {
  createAgentToolSession
} from "../../electron/tools/createAgentToolSession.js";

import {
  createWorkspaceToolDefinitions
} from "../../electron/tools/workspace/workspaceTools.js";

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
  "configurable tool runtime",
  () => {
    it(
      "filters toolsets and individual tools before exposing schemas",
      () => {
        const session =
          createAgentToolSession({
            settings: {
              tools: {
                enabled: true,
                runtime: {
                  defaultTimeoutMs: 15000
                },
                workspace: {
                  enabled: true,
                  includeProjectRoot: true,
                  roots: []
                },
                toolsets: {
                  "core.runtime": true,
                  "workspace.read": false,
                  "agent.internal": true
                },
                overrides: {
                  calculator: false
                }
              }
            }
          });

        assert.equal(
          "calculator" in
            session.tools,
          false
        );
        assert.equal(
          "read_text_file" in
            session.tools,
          false
        );
        assert.equal(
          "get_current_time" in
            session.tools,
          true
        );
        assert.equal(
          "ask_user" in
            session.tools,
          true
        );
      }
    );

    it(
      "applies the configured per-tool timeout",
      async () => {
        const executor =
          new ToolExecutor({
            defaultTimeoutMs: 5
          });

        const result =
          await executor.execute(
            {
              name: "slow_tool",
              title: "Slow tool",
              async execute() {
                await new Promise(
                  (resolve) => {
                    setTimeout(
                      resolve,
                      30
                    );
                  }
                );

                return "late";
              }
            },
            {}
          );

        assert.equal(
          result.ok,
          false
        );
        assert.equal(
          result.error.code,
          "TOOL_TIMEOUT"
        );
      }
    );

    it(
      "stops repeated calls and enforces the total tool-call budget",
      async () => {
        const repeatedExecutor =
          new ToolExecutor({
            maxIdenticalCalls: 1,
            maxToolCalls: 4
          });

        const definition = {
          name: "echo_tool",
          title: "Echo tool",
          async execute(input) {
            return input;
          }
        };

        const first =
          await repeatedExecutor.execute(
            definition,
            { value: 1 }
          );
        const repeated =
          await repeatedExecutor.execute(
            definition,
            { value: 1 }
          );

        assert.equal(first.ok, true);
        assert.equal(repeated.ok, false);
        assert.equal(
          repeated.error.code,
          "REPEATED_TOOL_CALL"
        );

        const limitedExecutor =
          new ToolExecutor({
            maxToolCalls: 1,
            maxIdenticalCalls: 5
          });

        await limitedExecutor.execute(
          definition,
          { value: 1 }
        );
        const limited =
          await limitedExecutor.execute(
            definition,
            { value: 2 }
          );

        assert.equal(limited.ok, false);
        assert.equal(
          limited.error.code,
          "TOOL_CALL_LIMIT"
        );
      }
    );

    it(
      "uses configured workspace roots and read limits",
      async () => {
        const root = fs.mkdtempSync(
          path.join(
            os.tmpdir(),
            "xixi-tool-settings-"
          )
        );
        temporaryRoots.push(root);

        fs.writeFileSync(
          path.join(root, "notes.txt"),
          "one\ntwo\nthree\nfour\n",
          "utf8"
        );

        const definitions =
          createWorkspaceToolDefinitions({
            enabled: true,
            includeProjectRoot: false,
            roots: [root],
            maxTextFileBytes: 100000,
            maxReadLines: 2,
            maxDirectoryEntries: 20,
            maxSearchResults: 20,
            maxSearchDepth: 2,
            maxHashFileBytes: 1000000
          });

        const read = definitions.find(
          (item) =>
            item.name ===
            "read_text_file"
        );

        const result =
          await read.execute({
            path: "notes.txt",
            startLine: 1,
            endLine: 100
          });

        assert.equal(
          result.endLine,
          2
        );
        assert.equal(
          result.content,
          "one\ntwo"
        );
        assert.equal(
          result.truncated,
          true
        );
      }
    );
  }
);
