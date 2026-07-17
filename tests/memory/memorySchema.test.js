import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import {
  sanitizeMemory,
  sanitizeMemoryData
} from "../../electron/memory/memorySchema.js";

describe(
  "memory schema",
  () => {
    it(
      "normalizes memory fields",
      () => {
        const memory =
          sanitizeMemory({
            id: "memory-1",
            category:
              "preference",
            content:
              "  喜欢   简洁界面  ",
            importance: 2,
            enabled: false,
            createdAt: 10,
            updatedAt: 20
          });

        assert.deepEqual(
          memory,
          {
            id: "memory-1",
            category:
              "preference",
            content:
              "喜欢 简洁界面",
            importance: 1,
            enabled: false,
            sourceConversationId:
              null,
            createdAt: 10,
            updatedAt: 20,
            lastUsedAt: 0
          }
        );
      }
    );

    it(
      "drops invalid and duplicate memories",
      () => {
        const data =
          sanitizeMemoryData({
            memories: [
              {
                id: "a",
                category: "project",
                content: "Xixi 项目"
              },
              {
                id: "b",
                category: "project",
                content: "  xixi   项目 "
              },
              {
                id: "c",
                content: ""
              }
            ]
          });

        assert.equal(
          data.memories.length,
          1
        );
      }
    );
  }
);
