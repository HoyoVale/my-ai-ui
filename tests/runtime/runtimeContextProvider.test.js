import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import {
  buildRuntimeContextSection,
  createRuntimeSnapshot
} from "../../electron/runtime/runtimeContextProvider.js";

describe(
  "RuntimeContextProvider",
  () => {
    it(
      "creates a sanitized environment snapshot with exact UTC time",
      () => {
        const now = new Date(
          "2026-07-18T03:30:25.000Z"
        );

        const snapshot =
          createRuntimeSnapshot({
            now,
            activeModel: {
              providerId:
                "ollama",
              providerName:
                "Ollama",
              modelName:
                "Qwen",
              model:
                "qwen3",
              contextTokenBudget:
                32768
            },
            workspaceSummary: {
              roots: [
                "/workspace"
              ],
              mode: "read-only"
            }
          });

        assert.equal(
          snapshot.utcDateTime,
          "2026-07-18T03:30:25.000Z"
        );
        assert.equal(
          snapshot.activeModel
            .modelId,
          "qwen3"
        );
        assert.equal(
          "environment" in snapshot,
          false
        );
      }
    );

    it(
      "builds a system section that tells the model to use tools for time and files",
      () => {
        const text =
          buildRuntimeContextSection({
            now: new Date(
              "2026-07-18T03:30:25.000Z"
            ),
            workspaceSummary: {
              roots: [
                "/workspace"
              ],
              mode: "read-only"
            }
          });

        assert.match(
          text,
          /当前运行环境/u
        );
        assert.match(
          text,
          /访问模式：只读/u
        );
        assert.match(
          text,
          /调用对应工具/u
        );
      }
    );

    it(
      "can disable automatic environment injection",
      () => {
        const text =
          buildRuntimeContextSection({
            contextSettings: {
              environment: {
                enabled: false
              }
            }
          });

        assert.equal(text, "");
      }
    );

    it(
      "keeps standard workspace details private and exposes full paths only when requested",
      () => {
        const workspaceSummary = {
          roots: [
            "/private/workspace"
          ],
          mode: "read-only"
        };

        const standard =
          buildRuntimeContextSection({
            workspaceSummary,
            contextSettings: {
              environment: {
                workspaceDetail:
                  "summary",
                toolDetail:
                  "profile"
              }
            }
          });

        assert.match(
          standard,
          /已授权 1 个目录/u
        );
        assert.doesNotMatch(
          standard,
          /\/private\/workspace/u
        );

        const detailed =
          buildRuntimeContextSection({
            workspaceSummary,
            contextSettings: {
              environment: {
                profile: "detailed",
                workspaceDetail:
                  "full",
                toolDetail:
                  "names"
              }
            }
          });

        assert.match(
          detailed,
          /\/private\/workspace/u
        );
        assert.match(
          detailed,
          /可用工具/u
        );
      }
    );

    it(
      "describes Coding workspaces as approval-gated read-write",
      () => {
        const text = buildRuntimeContextSection({
          toolSettings: {
            mode: "coding",
            workspace: {
              roots: ["/workspace"]
            },
            developer: {
              toolsetOverrides: {},
              toolOverrides: {}
            }
          },
          workspaceSettings: {
            roots: ["/workspace"]
          }
        });

        assert.match(text, /访问模式：读写/u);
        assert.match(text, /写入前受权限策略约束/u);
        assert.doesNotMatch(text, /只读工作区/u);
      }
    );

  }
);
