import {
  afterEach,
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  MemoryStore
} from "../../electron/memory/MemoryStore.js";

const directories = [];

afterEach(() => {
  for (
    const directory
    of directories.splice(0)
  ) {
    fs.rmSync(
      directory,
      {
        recursive: true,
        force: true
      }
    );
  }
});

function createStore() {
  const directory =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "xixi-memory-store-"
      )
    );

  directories.push(directory);

  const filePath =
    path.join(
      directory,
      "memories.json"
    );

  return {
    filePath,
    store:
      new MemoryStore({
        getFilePath: () =>
          filePath
      })
  };
}

describe(
  "MemoryStore",
  () => {
    it(
      "creates and reloads a v3 memory file",
      () => {
        const {
          store,
          filePath
        } = createStore();

        const empty =
          store.load();

        assert.deepEqual(
          empty,
          {
            version: 3,
            memories: []
          }
        );
        assert.equal(
          fs.existsSync(filePath),
          true
        );

        store.save({
          memories: [
            {
              id: "memory-1",
              title: "用户名称",
              content:
                "用户叫 Hoyo",
              description:
                "称呼用户时使用",
              tags: ["profile"],
              priority: 0.8,
              enabled: true,
              createdAt: 1,
              updatedAt: 1
            }
          ]
        });

        store.clearCache();

        const reloaded =
          store.load()
            .memories[0];

        assert.equal(
          reloaded.title,
          "用户名称"
        );
        assert.equal(
          reloaded.priority,
          0.8
        );
        assert.equal(
          "scope" in reloaded,
          false
        );
      }
    );

    it(
      "migrates a v2 file, removes scopes and creates a versioned backup",
      () => {
        const {
          store,
          filePath
        } = createStore();

        fs.writeFileSync(
          filePath,
          JSON.stringify({
            version: 2,
            memories: [
              {
                id: "legacy",
                title: "旧记忆",
                content:
                  "用户喜欢简洁界面",
                scope: "project",
                priority: 0.7,
                enabled: true,
                createdAt: 1,
                updatedAt: 2
              }
            ]
          }),
          "utf8"
        );

        const data =
          store.load();

        assert.equal(
          data.version,
          3
        );
        assert.equal(
          "scope" in
            data.memories[0],
          false
        );

        const saved =
          JSON.parse(
            fs.readFileSync(
              filePath,
              "utf8"
            )
          );

        assert.equal(
          saved.version,
          3
        );

        const backupPath =
          path.join(
            path.dirname(
              filePath
            ),
            "memories.v2.backup.json"
          );

        assert.equal(
          fs.existsSync(
            backupPath
          ),
          true
        );
      }
    );

    it(
      "migrates and backs up a legacy v1 file",
      () => {
        const {
          store,
          filePath
        } = createStore();

        fs.writeFileSync(
          filePath,
          JSON.stringify({
            version: 1,
            memories: [
              {
                id: "legacy",
                category:
                  "preference",
                content:
                  "用户喜欢简洁界面",
                importance: 0.7
              }
            ]
          }),
          "utf8"
        );

        const data =
          store.load();

        assert.equal(
          data.version,
          3
        );
        assert.equal(
          data.memories[0]
            .priority,
          0.7
        );
        assert.match(
          data.memories[0]
            .description,
          /旧版/
        );
        assert.equal(
          fs.existsSync(
            path.join(
              path.dirname(filePath),
              "memories.v1.backup.json"
            )
          ),
          true
        );
      }
    );

    it(
      "recovers from invalid JSON",
      () => {
        const {
          store,
          filePath
        } = createStore();

        fs.writeFileSync(
          filePath,
          "not-json",
          "utf8"
        );

        const originalWarn =
          console.warn;

        console.warn = () => {};

        try {
          assert.deepEqual(
            store.load()
              .memories,
            []
          );
        } finally {
          console.warn =
            originalWarn;
        }
      }
    );
  }
);
