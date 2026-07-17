import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import {
  buildMemoryContext
} from "../../electron/memory/memoryContextBuilder.js";

describe(
  "memory context builder",
  () => {
    it(
      "renders structured memories for the system prompt",
      () => {
        const result =
          buildMemoryContext([
            {
              category:
                "preference",
              content:
                "用户喜欢简洁界面"
            }
          ]);

        assert.match(
          result,
          /用户偏好/
        );
        assert.match(
          result,
          /用户喜欢简洁界面/
        );
      }
    );

    it(
      "returns empty text when there is no memory",
      () => {
        assert.equal(
          buildMemoryContext([]),
          ""
        );
      }
    );
  }
);
