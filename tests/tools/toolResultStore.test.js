import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

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
                text: "x".repeat(6000)
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
