const {
  app,
  BrowserWindow,
  ipcMain
} = require("electron");

const assert =
  require("node:assert/strict");

const path =
  require("node:path");

const CHANNELS =
  require(
    "../../electron/shared/ipcChannels.cjs"
  );

let completed = false;

function fail(error) {
  console.error(
    "Electron preload smoke test failed:",
    error
  );

  process.exitCode = 1;

  if (
    app.isReady()
  ) {
    app.quit();
  }
}

const timeout =
  setTimeout(
    () => {
      if (!completed) {
        fail(
          new Error(
            "Electron preload smoke test timed out."
          )
        );
      }
    },
    15000
  );

app.whenReady().then(
  async () => {
    let openInputReceived =
      false;

    let dragStartReceived =
      false;

    let openConversationReceived =
      false;

    ipcMain.on(
      CHANNELS
        .navigation
        .OPEN_INPUT,
      () => {
        openInputReceived =
          true;
      }
    );

    ipcMain.on(
      CHANNELS
        .navigation
        .OPEN_CONVERSATION,
      () => {
        openConversationReceived =
          true;
      }
    );

    ipcMain.on(
      CHANNELS
        .pet
        .DRAG_START,
      (_event, point) => {
        dragStartReceived =
          point?.x === 10 &&
          point?.y === 20;
      }
    );

    ipcMain.handle(
      CHANNELS
        .agent
        .GET_STATUS,
      () => ({
        state: "idle"
      })
    );

    ipcMain.handle(
      CHANNELS
        .settings
        .GET,
      () => ({
        general: {}
      })
    );

    ipcMain.handle(
      CHANNELS
        .conversation
        .GET,
      () => ({
        id: "conversation-1",
        title: "Smoke",
        messages: []
      })
    );

    ipcMain.handle(
      CHANNELS
        .conversation
        .GET_STATE,
      () => ({
        currentConversationId:
          null,
        currentConversation:
          null,
        totalConversations: 0
      })
    );

    const window =
      new BrowserWindow({
        show: false,

        webPreferences: {
          preload:
            path.resolve(
              __dirname,
              "../../electron/preload/preload.cjs"
            ),

          contextIsolation:
            true,

          nodeIntegration:
            false
        }
      });

    await window.loadURL(
      "data:text/html,<html><body>smoke</body></html>"
    );

    const result =
      await window
        .webContents
        .executeJavaScript(`
          (async () => {
            const requiredMethods = [
              "openInput",
              "openConversation",
              "startPetDrag",
              "sendAgentMessage",
              "getAgentStatus",
              "getSettings",
              "getConversationState",
              "getConversation",
              "createConversation",
              "onConversationChanged"
            ];

            const methodTypes =
              Object.fromEntries(
                requiredMethods.map(
                  (name) => [
                    name,
                    typeof window.api?.[name]
                  ]
                )
              );

            window.api.openInput();

            window.api.startPetDrag({
              x: 10,
              y: 20
            });

            window.api.openConversation();

            return {
              apiType:
                typeof window.api,

              methodTypes,

              agentStatus:
                await window.api
                  .getAgentStatus(),

              settings:
                await window.api
                  .getSettings(),

              conversationState:
                await window.api
                  .getConversationState(),

              conversation:
                await window.api
                  .getConversation(
                    "conversation-1"
                  )
            };
          })()
        `);

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          50
        )
    );

    assert.equal(
      result.apiType,
      "object"
    );

    for (
      const [
        name,
        type
      ]
      of Object.entries(
        result.methodTypes
      )
    ) {
      assert.equal(
        type,
        "function",
        `${name} was not exposed`
      );
    }

    assert.equal(
      result
        .agentStatus
        .state,
      "idle"
    );

    assert.deepEqual(
      result.settings,
      {
        general: {}
      }
    );

    assert.equal(
      result
        .conversationState
        .totalConversations,
      0
    );

    assert.equal(
      result
        .conversation
        .title,
      "Smoke"
    );

    assert.equal(
      openInputReceived,
      true
    );

    assert.equal(
      dragStartReceived,
      true
    );

    assert.equal(
      openConversationReceived,
      true
    );

    completed = true;

    clearTimeout(
      timeout
    );

    window.destroy();

    console.log(
      "Electron preload smoke test passed."
    );

    app.quit();
  }
).catch(fail);

app.on(
  "window-all-closed",
  () => {
    if (!completed) {
      fail(
        new Error(
          "Smoke window closed before completion."
        )
      );
    }
  }
);
