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
      "creates and reloads a memory file",
      () => {
        const {
          store,
          filePath
        } = createStore();

        const empty =
          store.load();

        assert.deepEqual(
          empty.memories,
          []
        );
        assert.equal(
          fs.existsSync(filePath),
          true
        );

        store.save({
          memories: [
            {
              id: "memory-1",
              category:
                "profile",
              content:
                "用户叫 Hoyo",
              importance: 0.8,
              enabled: true,
              createdAt: 1,
              updatedAt: 1
            }
          ]
        });

        store.clearCache();

        assert.equal(
          store.load()
            .memories[0]
            .content,
          "用户叫 Hoyo"
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
