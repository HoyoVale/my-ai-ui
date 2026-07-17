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
  constructor(data = null) {
    this.data =
      data ?? {
        version: 3,
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
  memorySettings = {},
  store = new MemoryTestStore()
) {
  let now = 100;
  let id = 0;

  return new MemoryManager({
    store,
    getSettings: () => ({
      memory: {
        enabled: true,
        maxInjected: 5,
        minPriority: 0,
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
  "MemoryManager v3",
  () => {
    it(
      "creates title, description, tags and priority",
      () => {
        const manager =
          createManager();

        const result =
          manager.create({
            title: "Xixi 技术栈",
            content:
              "使用 Electron",
            description:
              "讨论架构时使用",
            tags:
              "Electron, Xixi",
            priority: 0.8
          });

        assert.equal(
          result.ok,
          true
        );
        assert.equal(
          result.memory.title,
          "Xixi 技术栈"
        );
        assert.equal(
          result.memory.priority,
          0.8
        );
        assert.equal(
          "scope" in
            result.memory,
          false
        );
        assert.deepEqual(
          result.memory.tags,
          [
            "Electron",
            "Xixi"
          ]
        );
      }
    );

    it(
      "deduplicates matching content globally",
      () => {
        const manager =
          createManager();

        const first =
          manager.create({
            title: "界面偏好",
            content:
              "喜欢简洁界面",
            priority: 0.4
          });

        const second =
          manager.create({
            title:
              "简洁 UI 偏好",
            content:
              "  喜欢简洁界面  ",
            tags: ["UI"],
            priority: 0.9
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
            .priority,
          0.9
        );
        assert.equal(
          manager.list()[0]
            .title,
          "简洁 UI 偏好"
        );
      }
    );

    it(
      "filters by enabled state and searchable metadata",
      () => {
        const manager =
          createManager();

        manager.create({
          title: "开发环境",
          content:
            "使用 Windows",
          tags: ["PowerShell"]
        });

        manager.create({
          title: "Preload 规则",
          content:
            "保持单文件",
          description:
            "Electron 安全边界",
          enabled: false
        });

        assert.equal(
          manager.list({
            enabled: false
          }).length,
          1
        );
        assert.equal(
          manager.list({
            enabled: true
          }).length,
          1
        );
        assert.equal(
          manager.list({
            query: "PowerShell"
          })[0].title,
          "开发环境"
        );
      }
    );

    it(
      "sorts retrieval by relevance and priority",
      () => {
        const manager =
          createManager();

        manager.create({
          title: "测试暗号",
          content:
            "memory-key 对应紫色彗星",
          description:
            "测试长期记忆",
          priority: 0.6
        });
        manager.create({
          title: "所在地区",
          content:
            "用户在新加坡",
          priority: 1
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

        manager.create({
          content:
            "memory-key 不可用",
          enabled: false,
          priority: 1
        });

        assert.deepEqual(
          manager.retrieve({
            query: "memory-key"
          }),
          []
        );
      }
    );

    it(
      "respects injection limit and priority threshold",
      () => {
        const manager =
          createManager({
            maxInjected: 2,
            minPriority: 0.5
          });

        manager.create({
          content: "A",
          priority: 0.9
        });
        manager.create({
          content: "B",
          priority: 0.8
        });
        manager.create({
          content: "C",
          priority: 0.7
        });
        manager.create({
          content: "D",
          priority: 0.2
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
          priority: 1
        });

        assert.deepEqual(
          manager.retrieve(),
          []
        );
      }
    );

    it(
      "reports only meaningful memory counts",
      () => {
        const manager =
          createManager();

        manager.create({
          content: "A"
        });
        manager.create({
          content: "B",
          enabled: false
        });

        assert.deepEqual(
          manager.getState(),
          {
            totalMemories: 2,
            enabledMemories: 1,
            disabledMemories: 1
          }
        );
      }
    );
  }
);
