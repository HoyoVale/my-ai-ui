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
  ConversationStore
} from "../../electron/conversation/ConversationStore.js";

const temporaryDirectories = [];

function createStore() {
  const directory =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "xixi-conversation-"
      )
    );

  temporaryDirectories.push(
    directory
  );

  const filePath =
    path.join(
      directory,
      "conversations.json"
    );

  return {
    filePath,

    store:
      new ConversationStore({
        getFilePath: () =>
          filePath
      })
  };
}

afterEach(() => {
  for (
    const directory
    of temporaryDirectories.splice(0)
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

describe(
  "ConversationStore",
  () => {
    it(
      "creates a valid empty store when the file does not exist",
      () => {
        const {
          filePath,
          store
        } = createStore();

        assert.deepEqual(
          store.load(),
          {
            version: 1,
            currentConversationId:
              null,
            conversations: []
          }
        );

        assert.equal(
          fs.existsSync(
            filePath
          ),
          true
        );
      }
    );

    it(
      "persists and reloads sanitized data",
      () => {
        const {
          filePath,
          store
        } = createStore();

        store.save({
          currentConversationId:
            "conversation-1",

          conversations: [
            {
              id:
                "conversation-1",
              title: "Test",
              createdAt: 1,
              updatedAt: 2,
              messages: [
                {
                  id:
                    "message-1",
                  role: "user",
                  content:
                    "Hello",
                  status:
                    "complete",
                  createdAt: 2
                }
              ]
            }
          ]
        });

        const secondStore =
          new ConversationStore({
            getFilePath: () =>
              filePath
          });

        const loaded =
          secondStore.load();

        assert.equal(
          loaded
            .currentConversationId,
          "conversation-1"
        );

        assert.equal(
          loaded
            .conversations[0]
            .messages[0]
            .content,
          "Hello"
        );
      }
    );

    it(
      "recovers from invalid JSON",
      () => {
        const {
          filePath,
          store
        } = createStore();

        fs.mkdirSync(
          path.dirname(
            filePath
          ),
          {
            recursive: true
          }
        );

        fs.writeFileSync(
          filePath,
          "{not-json",
          "utf8"
        );

        const originalWarn =
          console.warn;

        console.warn = () => {};

        try {
          assert.deepEqual(
            store.load(),
            {
              version: 1,
              currentConversationId:
                null,
              conversations: []
            }
          );
        } finally {
          console.warn =
            originalWarn;
        }
      }
    );
  }
);
