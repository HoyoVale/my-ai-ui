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
  createRuntimeSnapshot
} from "../../electron/runtime/runtimeContextProvider.js";

import {
  createRuntimeToolDefinitions
} from "../../electron/tools/runtime/runtimeTools.js";

import {
  getWorkspacePolicySummary,
  getWorkspaceRoots,
  resolveWorkspacePath
} from "../../electron/tools/workspace/workspacePolicy.js";

const temporaryRoots = [];
const previousWorkspaceRoot =
  process.env.XIXI_WORKSPACE_ROOT;
const previousWorkspaceRoots =
  process.env.XIXI_WORKSPACE_ROOTS;

afterEach(() => {
  if (previousWorkspaceRoot === undefined) {
    delete process.env.XIXI_WORKSPACE_ROOT;
  } else {
    process.env.XIXI_WORKSPACE_ROOT =
      previousWorkspaceRoot;
  }

  if (previousWorkspaceRoots === undefined) {
    delete process.env.XIXI_WORKSPACE_ROOTS;
  } else {
    process.env.XIXI_WORKSPACE_ROOTS =
      previousWorkspaceRoots;
  }

  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, {
      recursive: true,
      force: true
    });
  }
});

describe(
  "explicit workspace boundary",
  () => {
    it(
      "does not infer a workspace from cwd, legacy flags or environment variables",
      () => {
        process.env.XIXI_WORKSPACE_ROOT =
          process.cwd();
        process.env.XIXI_WORKSPACE_ROOTS =
          process.cwd();

        assert.deepEqual(
          getWorkspaceRoots({
            includeProjectRoot: true,
            roots: []
          }),
          []
        );
        assert.equal(
          getWorkspacePolicySummary({
            includeProjectRoot: true,
            roots: []
          }),
          null
        );
        assert.throws(
          () => resolveWorkspacePath("."),
          (error) =>
            error?.code ===
            "WORKSPACE_NOT_CONFIGURED"
        );
      }
    );

    it(
      "returns a read-only summary only for explicitly configured roots",
      () => {
        const root = fs.mkdtempSync(
          path.join(
            os.tmpdir(),
            "xixi-workspace-boundary-"
          )
        );
        temporaryRoots.push(root);

        const summary =
          getWorkspacePolicySummary({
            roots: [
              ` ${root} `,
              root
            ]
          });

        assert.deepEqual(
          summary.roots,
          [path.resolve(root)]
        );
        assert.equal(
          summary.mode,
          "read-only"
        );
      }
    );

    it(
      "omits workspace tools and workspace runtime metadata when no root is configured",
      () => {
        const definitions =
          createRuntimeToolDefinitions({
            settings: {
              tools: {
                mode: "coding",
                workspace: {
                  roots: []
                }
              }
            }
          });

        assert.equal(
          definitions.some(
            (item) =>
              item.name ===
              "get_workspace_info"
          ),
          false
        );

        const snapshot =
          createRuntimeSnapshot({
            toolSettings: {
              mode: "coding",
              workspace: {
                roots: []
              }
            },
            workspaceSettings: {
              roots: []
            }
          });

        assert.equal(
          snapshot.workspace,
          null
        );
        assert.equal(
          snapshot.toolProfile.tools.some(
            (name) =>
              [
                "get_workspace_info",
                "read_text_file",
                "search_text"
              ].includes(name)
          ),
          false
        );
      }
    );
  }
);
