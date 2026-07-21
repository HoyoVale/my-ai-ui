import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ToolResultStore
} from "../../electron/tools/core/ToolResultStore.js";

describe(
  "ToolResultStore",
  () => {
    it(
      "keeps small results inline",
      () => {
        const store =
          new ToolResultStore({
            maxInlineBytes: 2000
          });

        const captured =
          store.capture({
            ok: true,
            data: {
              value: 42
            }
          });

        assert.equal(
          captured.meta.truncated,
          false
        );
        assert.equal(
          captured.result.status,
          "success"
        );
        assert.equal(
          captured.result.truncated,
          false
        );
        assert.equal(
          captured.result.data.data.value,
          42
        );
        assert.equal(
          captured.value.data.value,
          42
        );
      }
    );

    it(
      "stores large results and returns them in chunks",
      () => {
        const store =
          new ToolResultStore({
            maxInlineBytes: 2000,
            maxStoredBytes: 12000,
            defaultChunkCharacters: 1000
          });

        const captured =
          store.capture(
            {
              ok: true,
              data: {
                text: "x".repeat(6000),
                changePreview: {
                  paths: ["src/App.jsx"],
                  diff: "--- a/src/App.jsx\n+++ b/src/App.jsx\n-old\n+new",
                  truncated: false
                }
              }
            },
            {
              toolName:
                "search_text"
            }
          );

        assert.equal(
          captured.meta.truncated,
          true
        );
        assert.equal(
          captured.result.truncated,
          true
        );
        assert.equal(
          captured.result.reference.type,
          "tool_result"
        );
        assert.equal(
          captured.result.originalBytes >=
            captured.result.storedBytes,
          true
        );
        assert.deepEqual(
          captured.result.changePreview?.paths,
          ["src/App.jsx"]
        );
        assert.match(
          captured.result.changePreview?.diff ?? "",
          /\+new/u
        );

        const resultId =
          captured.value.data
            .resultId;
        const first =
          store.read(resultId, {
            limit: 1000
          });

        assert.equal(first.ok, true);
        assert.equal(
          first.data.content.length,
          1000
        );
        assert.equal(
          first.data.hasMore,
          true
        );
        assert.equal(
          typeof first.data.nextOffset,
          "number"
        );
      }
    );

    it(
      "marks results clipped when the stored result reaches its hard limit",
      () => {
        const store = new ToolResultStore({
          maxInlineBytes: 2000,
          maxStoredBytes: 2500
        });
        const captured = store.capture({
          ok: true,
          data: {
            text: "内容".repeat(6000)
          }
        });

        assert.equal(captured.result.truncated, true);
        assert.equal(captured.result.clipped, true);
        assert.equal(
          captured.result.originalBytes >
            captured.result.storedBytes,
          true
        );
        assert.equal(
          store.list()[0].clipped,
          true
        );
      }
    );

    it(
      "reopens large result references from task-scoped disk storage",
      () => {
        const directory = fs.mkdtempSync(
          path.join(os.tmpdir(), "tool-result-store-")
        );

        try {
          const firstStore = new ToolResultStore({
            maxInlineBytes: 2000,
            maxStoredBytes: 12000,
            storageDirectory: directory
          });
          const captured = firstStore.capture({
            ok: true,
            data: { text: "persisted".repeat(1000) }
          });
          const resultId = captured.result.reference.resultId;
          const secondStore = new ToolResultStore({
            maxInlineBytes: 2000,
            maxStoredBytes: 12000,
            storageDirectory: directory
          });
          const reopened = secondStore.read(resultId, { limit: 800 });

          assert.equal(reopened.ok, true);
          assert.equal(reopened.data.resultId, resultId);
          assert.equal(reopened.data.content.length, 800);
        } finally {
          fs.rmSync(directory, { recursive: true, force: true });
        }
      }
    );


    it(
      "keeps persisted result references scoped to one workspace",
      () => {
        const directory = fs.mkdtempSync(
          path.join(os.tmpdir(), "tool-result-workspace-")
        );

        try {
          const firstStore = new ToolResultStore({
            maxInlineBytes: 2000,
            maxStoredBytes: 12000,
            storageDirectory: directory,
            taskId: "task-1",
            workspaceId: "workspace-a"
          });
          const captured = firstStore.capture({
            ok: true,
            data: { text: "workspace".repeat(1000) }
          });
          const resultId = captured.result.reference.resultId;
          const wrongWorkspace = new ToolResultStore({
            maxInlineBytes: 2000,
            maxStoredBytes: 12000,
            storageDirectory: directory,
            taskId: "task-1",
            workspaceId: "workspace-b"
          });
          const rejected = wrongWorkspace.read(resultId);

          assert.equal(rejected.ok, false);
          assert.equal(
            rejected.error.code,
            "TOOL_RESULT_NOT_FOUND"
          );
        } finally {
          fs.rmSync(directory, { recursive: true, force: true });
        }
      }
    );

    it(
      "rejects legacy unowned disk results from a scoped task",
      () => {
        const directory = fs.mkdtempSync(
          path.join(os.tmpdir(), "tool-result-unowned-")
        );

        try {
          const legacyStore = new ToolResultStore({
            maxInlineBytes: 2000,
            maxStoredBytes: 12000,
            storageDirectory: directory
          });
          const captured = legacyStore.capture({
            ok: true,
            data: { text: "legacy".repeat(1000) }
          });
          const scopedStore = new ToolResultStore({
            maxInlineBytes: 2000,
            maxStoredBytes: 12000,
            storageDirectory: directory,
            taskId: "task-scoped",
            workspaceId: "workspace-scoped"
          });
          const rejected = scopedStore.read(
            captured.result.reference.resultId
          );

          assert.equal(rejected.ok, false);
          assert.equal(
            rejected.error.code,
            "TOOL_RESULT_NOT_FOUND"
          );
        } finally {
          fs.rmSync(directory, { recursive: true, force: true });
        }
      }
    );

    it(
      "enforces workspace ownership for in-memory result entries",
      () => {
        const store = new ToolResultStore({
          maxInlineBytes: 2000,
          maxStoredBytes: 12000,
          taskId: "task-1",
          workspaceId: "workspace-a"
        });
        const captured = store.capture(
          {
            ok: true,
            data: { text: "private".repeat(1000) }
          },
          {
            taskId: "task-1",
            workspaceId: "workspace-b"
          }
        );
        const resultId = captured.result.reference.resultId;

        assert.equal(store.read(resultId).ok, false);
        assert.deepEqual(store.list(), []);
      }
    );

    it(
      "uses the same envelope for failures and cancellations",
      () => {
        const store = new ToolResultStore();
        const failed = store.captureFailure({
          ok: false,
          error: {
            code: "PERMISSION_DENIED",
            message: "Access denied",
            retryable: false
          }
        });
        const cancelled = store.captureFailure(
          {
            ok: false,
            error: {
              code: "CANCELLED_BY_USER",
              message: "Cancelled",
              retryable: false
            }
          },
          { cancelled: true }
        );

        assert.equal(failed.result.status, "error");
        assert.equal(
          failed.result.error.code,
          "PERMISSION_DENIED"
        );
        assert.equal(
          cancelled.result.status,
          "cancelled"
        );
      }
    );
  }
);
