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
  "memory context builder v3",
  () => {
    it(
      "renders title and content without management metadata",
      () => {
        const result =
          buildMemoryContext([
            {
              title: "界面偏好",
              content:
                "用户喜欢简洁界面",
              description:
                "仅用于管理",
              tags: ["UI"]
            }
          ]);

        assert.match(
          result,
          /界面偏好/
        );
        assert.match(
          result,
          /用户喜欢简洁界面/
        );
        assert.doesNotMatch(
          result,
          /仅用于管理/
        );
        assert.doesNotMatch(
          result,
          /当前项目|全局/
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
