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
  }
);
