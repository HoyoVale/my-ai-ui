import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import {
  MemoryManager
} from "../../electron/memory/MemoryManager.js";

class MemoryTestStore {
  constructor() {
    this.data = {
      version: 1,
      memories: []
    };
  }

  load() {
    return structuredClone(
      this.data
    );
  }

  save(data) {
    this.data =
      structuredClone(data);
    return this.load();
  }
}

function createManager(
  memorySettings = {}
) {
  let now = 100;
  let id = 0;

  return new MemoryManager({
    store:
      new MemoryTestStore(),
    getSettings: () => ({
      memory: {
        enabled: true,
        maxInjected: 5,
        minImportance: 0,
        ...memorySettings
      }
    }),
    now: () => {
      now += 1;
      return now;
    },
    createId: () => {
      id += 1;
      return `memory-${id}`;
    }
  });
}

describe(
  "MemoryManager",
  () => {
    it(
      "deduplicates and updates matching content",
      () => {
        const manager =
          createManager();

        const first =
          manager.create({
            category:
              "preference",
            content:
              "喜欢简洁界面",
            importance: 0.4
          });

        const second =
          manager.create({
            category:
              "preference",
            content:
              "  喜欢简洁界面  ",
            importance: 0.9
          });

        assert.equal(
          first.created,
          true
        );
        assert.equal(
          second.deduplicated,
          true
        );
        assert.equal(
          manager.list().length,
          1
        );
        assert.equal(
          manager.list()[0]
            .importance,
          0.9
        );
      }
    );

    it(
      "sorts retrieval by relevance and importance",
      () => {
        const manager =
          createManager();

        manager.create({
          category: "project",
          content:
            "memory-key 对应紫色彗星",
          importance: 0.6
        });
        manager.create({
          category: "profile",
          content:
            "用户在新加坡",
          importance: 1
        });

        const result =
          manager.retrieve({
            query:
              "memory-key 是什么",
            limit: 2
          });

        assert.equal(
          result[0].content,
          "memory-key 对应紫色彗星"
        );
      }
    );

    it(
      "does not retrieve disabled memories",
      () => {
        const manager =
          createManager();

        const result =
          manager.create({
            content:
              "memory-key 不可用",
            enabled: false,
            importance: 1
          });

        assert.equal(
          result.ok,
          true
        );
        assert.deepEqual(
          manager.retrieve({
            query: "memory-key"
          }),
          []
        );
      }
    );

    it(
      "respects injection limit and importance threshold",
      () => {
        const manager =
          createManager({
            maxInjected: 2,
            minImportance: 0.5
          });

        manager.create({
          content: "A",
          importance: 0.9
        });
        manager.create({
          content: "B",
          importance: 0.8
        });
        manager.create({
          content: "C",
          importance: 0.7
        });
        manager.create({
          content: "D",
          importance: 0.2
        });

        const result =
          manager.retrieve();

        assert.equal(
          result.length,
          2
        );
        assert.deepEqual(
          result.map(
            (memory) =>
              memory.content
          ),
          ["A", "B"]
        );
      }
    );

    it(
      "disables all retrieval through settings",
      () => {
        const manager =
          createManager({
            enabled: false
          });

        manager.create({
          content: "A",
          importance: 1
        });

        assert.deepEqual(
          manager.retrieve(),
          []
        );
      }
    );
  }
);
