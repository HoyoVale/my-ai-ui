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
  "memory schema v3",
  () => {
    it(
      "normalizes title, content, description, tags and priority",
      () => {
        const memory =
          sanitizeMemory({
            id: "memory-1",
            title:
              "  Xixi   技术栈 ",
            content:
              "  使用   Electron  ",
            description:
              "  用于   架构讨论 ",
            tags: [
              "Electron",
              " electron ",
              "Xixi"
            ],
            priority: 2,
            enabled: false,
            createdAt: 10,
            updatedAt: 20
          });

        assert.deepEqual(
          memory,
          {
            id: "memory-1",
            title: "Xixi 技术栈",
            content:
              "使用 Electron",
            description:
              "用于 架构讨论",
            tags: [
              "Electron",
              "Xixi"
            ],
            priority: 1,
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
      "migrates legacy category, importance and scope without keeping system categories",
      () => {
        const memory =
          sanitizeMemory({
            id: "legacy-1",
            category: "project",
            scope: "project",
            content:
              "Xixi 使用 Electron",
            importance: 0.8,
            enabled: true,
            createdAt: 1,
            updatedAt: 2
          });

        assert.equal(
          memory.priority,
          0.8
        );
        assert.equal(
          memory.title,
          "Xixi 使用 Electron"
        );
        assert.deepEqual(
          memory.tags,
          []
        );
        assert.match(
          memory.description,
          /旧版/
        );
        assert.equal(
          "category" in memory,
          false
        );
        assert.equal(
          "importance" in memory,
          false
        );
        assert.equal(
          "scope" in memory,
          false
        );
      }
    );

    it(
      "merges duplicate content left by the removed scope model",
      () => {
        const data =
          sanitizeMemoryData({
            version: 2,
            memories: [
              {
                id: "global",
                title: "语言偏好",
                content: "使用中文",
                tags: ["language"],
                scope: "global",
                priority: 0.5,
                enabled: false,
                createdAt: 1,
                updatedAt: 2
              },
              {
                id: "project",
                title: "中文回答",
                content:
                  "  使用中文 ",
                tags: ["reply"],
                scope: "project",
                priority: 0.9,
                enabled: true,
                createdAt: 3,
                updatedAt: 4
              }
            ]
          });

        assert.equal(
          data.version,
          3
        );
        assert.equal(
          data.memories.length,
          1
        );
        assert.equal(
          data.memories[0].title,
          "中文回答"
        );
        assert.equal(
          data.memories[0].priority,
          0.9
        );
        assert.equal(
          data.memories[0].enabled,
          true
        );
        assert.deepEqual(
          data.memories[0].tags,
          ["language", "reply"]
        );
      }
    );

    it(
      "drops invalid memories and duplicate ids",
      () => {
        const data =
          sanitizeMemoryData({
            memories: [
              {
                id: "a",
                content: "有效记忆"
              },
              {
                id: "a",
                content: "另一个内容"
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
