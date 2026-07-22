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
const stores = [];

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

  const store =
    new ConversationStore({
      getFilePath: () =>
        filePath
    });

  stores.push(store);

  return {
    filePath,
    store
  };
}

afterEach(async () => {
  await Promise.all(
    stores.splice(0).map((store) => store.flush())
  );

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
      async () => {
        const {
          filePath,
          store
        } = createStore();

        assert.deepEqual(
          store.load(),
          {
            version: 22,
            currentConversationId:
              null,
            conversations: []
          }
        );

        await store.flush();

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
      async () => {
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

        await store.flush();

        const secondStore =
          new ConversationStore({
            getFilePath: () =>
              filePath
          });

        stores.push(secondStore);

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
      "migrates v1 conversations to managed context defaults",
      () => {
        const {
          filePath,
          store
        } = createStore();

        fs.writeFileSync(
          filePath,
          JSON.stringify({
            version: 1,
            currentConversationId: "legacy",
            conversations: [
              {
                id: "legacy",
                title: "Legacy",
                summary: "obsolete summary",
                createdAt: 1,
                updatedAt: 2,
                messages: [
                  {
                    id: "legacy-message",
                    role: "user",
                    content: "hello",
                    status: "complete",
                    createdAt: 2
                  }
                ]
              }
            ]
          }),
          "utf8"
        );

        const loaded =
          store.load();

        assert.equal(
          loaded.version,
          22
        );
        assert.equal(
          Object.hasOwn(
            loaded.conversations[0],
            "summary"
          ),
          false
        );
        assert.equal(
          loaded.conversations[0]
            .contextStartAfterMessageId,
          null
        );
        assert.equal(
          loaded.conversations[0]
            .messages[0]
            .includeInContext,
          true
        );
        assert.equal(
          loaded.conversations[0]
            .messages[0]
            .pinnedToContext,
          false
        );
      }
    );

    it(
      "persists a bounded final baseline-to-workspace diff summary",
      async () => {
        const { filePath, store } = createStore();
        store.save({
          currentConversationId: "conversation-diff",
          conversations: [{
            id: "conversation-diff",
            title: "Diff",
            createdAt: 1,
            updatedAt: 2,
            messages: [{
              id: "assistant-diff",
              role: "assistant",
              content: "done",
              status: "complete",
              createdAt: 2,
              diffSummary: {
                version: 1,
                runId: "run-diff",
                workspaceId: "workspace-diff",
                revision: 2,
                empty: false,
                totals: { files: 1, added: 1, removed: 1, addedFiles: 0, deletedFiles: 0, renamedFiles: 0, binaryFiles: 0 },
                files: [{
                  path: "src/app.js",
                  oldPath: "",
                  status: "modified",
                  binary: false,
                  beforeSha256: "a",
                  afterSha256: "b",
                  beforeBytes: 4,
                  afterBytes: 4,
                  added: 1,
                  removed: 1,
                  diff: "--- a/src/app.js\n+++ b/src/app.js\n-old\n+new",
                  truncated: false
                }]
              }
            }]
          }]
        });
        await store.flush();
        const secondStore = new ConversationStore({ getFilePath: () => filePath });
        stores.push(secondStore);
        const summary = secondStore.load().conversations[0].messages[0].diffSummary;
        assert.equal(summary.runId, "run-diff");
        assert.equal(summary.files.length, 1);
        assert.match(summary.files[0].diff, /\+new/u);
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
              version: 22,
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
