const assert =
  require("node:assert/strict");

const fs =
  require("node:fs");

const os =
  require("node:os");

const path =
  require("node:path");

const {
  spawn
} = require("node:child_process");

const {
  _electron: electron
} = require("playwright");

const electronPath =
  require("electron");

const projectRoot =
  path.resolve(
    __dirname,
    "../.."
  );

const resultsDir =
  path.join(
    projectRoot,
    "test-results"
  );

function delay(milliseconds) {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds
      );
    }
  );
}

async function waitForServer(
  url,
  timeoutMs = 30000
) {
  const deadline =
    Date.now() +
    timeoutMs;

  while (
    Date.now() <
    deadline
  ) {
    try {
      const response =
        await fetch(url);

      if (response.ok) {
        return;
      }
    } catch {
      // Vite 还没有开始监听。
    }

    await delay(100);
  }

  throw new Error(
    `Vite server did not start: ${url}`
  );
}

async function waitForWindow(
  electronApp,
  route,
  timeoutMs = 15000
) {
  const expected =
    `#${route}`;

  const deadline =
    Date.now() +
    timeoutMs;

  while (
    Date.now() <
    deadline
  ) {
    for (
      const page
      of electronApp.windows()
    ) {
      if (
        page
          .url()
          .includes(
            expected
          )
      ) {
        await page
          .waitForLoadState(
            "domcontentloaded"
          );

        return page;
      }
    }

    await delay(50);
  }

  const urls =
    electronApp
      .windows()
      .map(
        (page) =>
          page.url()
      );

  throw new Error(
    `Window ${route} not found. Existing: ${urls.join(", ")}`
  );
}

async function waitForText(
  locator,
  expected,
  timeoutMs = 15000
) {
  const deadline =
    Date.now() +
    timeoutMs;

  while (
    Date.now() <
    deadline
  ) {
    const text =
      await locator
        .textContent()
        .catch(
          () => ""
        );

    if (
      text?.includes(
        expected
      )
    ) {
      return text;
    }

    await delay(50);
  }

  throw new Error(
    `Text not found: ${expected}`
  );
}


async function waitForAttribute(
  locator,
  name,
  expected,
  timeoutMs = 15000
) {
  const deadline =
    Date.now() +
    timeoutMs;

  while (
    Date.now() <
    deadline
  ) {
    const value =
      await locator
        .getAttribute(name)
        .catch(
          () => null
        );

    if (value === expected) {
      return;
    }

    await delay(50);
  }

  throw new Error(
    `Attribute ${name} did not become ${expected}.`
  );
}

async function waitForCount(
  locator,
  expected,
  timeoutMs = 15000
) {
  const deadline =
    Date.now() +
    timeoutMs;

  while (
    Date.now() <
    deadline
  ) {
    const count =
      await locator.count();

    if (count === expected) {
      return;
    }

    await delay(50);
  }

  throw new Error(
    `Expected ${expected} elements, got ${await locator.count()}`
  );
}

async function waitForWindowVisible(
  electronApp,
  page,
  expected,
  timeoutMs = 10000
) {
  const browserWindow =
    await electronApp
      .browserWindow(page);

  const deadline =
    Date.now() +
    timeoutMs;

  while (
    Date.now() <
    deadline
  ) {
    const visible =
      await browserWindow
        .evaluate(
          (window) =>
            window.isVisible()
        );

    if (
      visible === expected
    ) {
      return;
    }

    await delay(50);
  }

  throw new Error(
    `Window visibility did not become ${expected}.`
  );
}

async function captureFailure(
  electronApp
) {
  fs.mkdirSync(
    resultsDir,
    {
      recursive: true
    }
  );

  const pages =
    electronApp?.windows?.() ??
    [];

  for (
    let index = 0;
    index < pages.length;
    index += 1
  ) {
    const page =
      pages[index];

    try {
      await page.screenshot({
        path:
          path.join(
            resultsDir,
            `e2e-failure-${index}.png`
          )
      });
    } catch {
      // 页面可能已在失败过程中关闭。
    }
  }
}

async function main() {
  fs.rmSync(
    resultsDir,
    {
      recursive: true,
      force: true
    }
  );

  const userDataDir =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "xixi-e2e-"
      )
    );

  const serverUrl =
    "http://127.0.0.1:4173";

  const viteEntry =
    path.join(
      projectRoot,
      "node_modules",
      "vite",
      "bin",
      "vite.js"
    );

  const viteProcess =
    spawn(
      process.execPath,
      [
        viteEntry,
        "--host",
        "127.0.0.1",
        "--port",
        "4173",
        "--strictPort"
      ],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          VITE_DEV_SERVER_URL:
            serverUrl
        },
        stdio: [
          "ignore",
          "pipe",
          "pipe"
        ]
      }
    );

  viteProcess.stdout.on(
    "data",
    (chunk) => {
      process.stdout.write(
        `[vite] ${chunk}`
      );
    }
  );

  viteProcess.stderr.on(
    "data",
    (chunk) => {
      process.stderr.write(
        `[vite] ${chunk}`
      );
    }
  );

  let electronApp = null;

  try {
    await waitForServer(
      serverUrl
    );

    const args = [
      projectRoot
    ];

    if (
      process.platform ===
      "linux"
    ) {
      args.unshift(
        "--no-sandbox"
      );
    }

    electronApp =
      await electron.launch({
        executablePath:
          electronPath,

        args,
        cwd:
          projectRoot,

        chromiumSandbox:
          false,

        env: {
          ...process.env,

          VITE_DEV_SERVER_URL:
            serverUrl,

          XIXI_E2E: "1",

          XIXI_E2E_USER_DATA:
            userDataDir
        },

        timeout: 30000
      });

    electronApp.on(
      "console",
      async (message) => {
        const values = [];

        for (
          const argument
          of message.args()
        ) {
          values.push(
            await argument
              .jsonValue()
              .catch(
                () =>
                  String(argument)
              )
          );
        }

        console.log(
          "[electron-main]",
          ...values
        );
      }
    );

    const pet =
      await electronApp
        .firstWindow();

    await pet
      .locator(
        '[data-testid="pet-sprite"]'
      )
      .waitFor();

    await pet
      .locator(
        '[data-testid="pet-sprite"]'
      )
      .click({
        button: "right"
      });

    await pet
      .locator(
        '[data-testid="pet-menu-input"]'
      )
      .click();

    const input =
      await waitForWindow(
        electronApp,
        "/input"
      );

    const inputField =
      input.locator(
        '[data-testid="input-textarea"]'
      );

    const sendButton =
      input.locator(
        '[data-testid="input-send"]'
      );

    await inputField.fill(
      "first message"
    );

    await sendButton.click();

    const response =
      await waitForWindow(
        electronApp,
        "/response"
      );

    const responseText =
      response.locator(
        '[data-testid="response-text"]'
      );

    await waitForText(
      responseText,
      "E2E_REPLY_1:first message"
    );

    await waitForWindowVisible(
      electronApp,
      response,
      true
    );

    await waitForAttribute(
      sendButton,
      "aria-label",
      "Send"
    );

    await response
      .locator(
        '[data-testid="response-bubble"]'
      )
      .hover();

    await response
      .locator(
        '[data-testid="response-close"]'
      )
      .click();

    await waitForWindowVisible(
      electronApp,
      response,
      false
    );

    await inputField.fill(
      "second message"
    );

    await sendButton.click();

    await waitForText(
      responseText,
      "E2E_REPLY_2:second message"
    );

    await waitForWindowVisible(
      electronApp,
      response,
      true
    );

    await waitForAttribute(
      sendButton,
      "aria-label",
      "Send"
    );

    await pet
      .locator(
        '[data-testid="pet-sprite"]'
      )
      .click({
        button: "right"
      });

    await pet
      .locator(
        '[data-testid="pet-menu-conversation"]'
      )
      .click();

    const conversation =
      await waitForWindow(
        electronApp,
        "/conversation"
      );

    await waitForText(
      conversation.locator(
        '[data-testid="conversation-current-title"]'
      ),
      "first message"
    );

    await waitForCount(
      conversation.locator(
        '[data-testid="conversation-message"]'
      ),
      4
    );

    const messages =
      await conversation
        .locator(
          '[data-testid="conversation-message"]'
        )
        .allTextContents();

    assert.equal(
      messages.some(
        (text) =>
          text.includes(
            "E2E_REPLY_2:second message"
          )
      ),
      true
    );

    await conversation
      .locator(
        '[data-testid="conversation-new"]'
      )
      .click();

    await waitForText(
      conversation.locator(
        '[data-testid="conversation-current-title"]'
      ),
      "新会话"
    );

    await conversation
      .locator(
        '[data-testid="conversation-empty"]'
      )
      .waitFor();

    const previousConversation =
      conversation
        .locator(
          '[data-testid="conversation-history-item"]'
        )
        .filter({
          hasText:
            "first message"
        })
        .first();

    await previousConversation
      .locator("button")
      .first()
      .click();

    await waitForText(
      conversation.locator(
        '[data-testid="conversation-current-title"]'
      ),
      "first message"
    );

    await waitForCount(
      conversation.locator(
        '[data-testid="conversation-message"]'
      ),
      4
    );

    await pet.evaluate(
      () => {
        window.api
          ?.openSetting?.();
      }
    );

    const setting =
      await waitForWindow(
        electronApp,
        "/setting"
      );

    await setting
      .locator(
        '[data-testid="setting-tab-conversationWindow"]'
      )
      .click();

    await waitForText(
      setting.locator(
        ".setting-page__header"
      ),
      "会话窗口"
    );

    await waitForText(
      setting.locator(
        ".setting-page__body"
      ),
      "侧栏宽度"
    );

    await setting
      .locator(
        '[data-testid="setting-tab-memory"]'
      )
      .click();

    await waitForText(
      setting.locator(
        ".setting-page__header"
      ),
      "长期记忆"
    );

    await pet.evaluate(
      () => {
        window.api
          ?.openMemory?.();
      }
    );

    const memory =
      await waitForWindow(
        electronApp,
        "/memory"
      );

    await memory
      .locator(
        '[data-testid="memory-new"]'
      )
      .click();

    await memory
      .locator(
        '[data-testid="memory-content"]'
      )
      .fill(
        "memory-key 对应紫色彗星"
      );

    await memory
      .locator(
        '[data-testid="memory-save"]'
      )
      .click();

    await waitForText(
      memory.locator(
        '[data-testid="memory-list-item"]'
      ).first(),
      "memory-key 对应紫色彗星"
    );

    await pet.evaluate(
      async () => {
        await window.api
          ?.createConversation?.();
      }
    );

    await inputField.fill(
      "memory-key"
    );

    await sendButton.click();

    await waitForText(
      responseText,
      "E2E_MEMORY:memory-key 对应紫色彗星"
    );

    await waitForAttribute(
      sendButton,
      "aria-label",
      "Send"
    );

    await memory
      .locator(
        '[data-testid="memory-enabled"]'
      )
      .click();

    await memory
      .locator(
        '[data-testid="memory-save"]'
      )
      .click();

    await waitForText(
      memory.locator(
        ".memory-save-status"
      ),
      "已保存"
    );

    await pet.evaluate(
      async () => {
        await window.api
          ?.createConversation?.();
      }
    );

    await inputField.fill(
      "memory-key"
    );

    await sendButton.click();

    await waitForText(
      responseText,
      "E2E_MEMORY_NONE"
    );

    await waitForAttribute(
      sendButton,
      "aria-label",
      "Send"
    );

    console.log(
      "Playwright Electron E2E passed: replies, response re-open, conversation switch, settings, memory injection and memory disable."
    );
  } catch (error) {
    if (electronApp) {
      await captureFailure(
        electronApp
      );
    }

    throw error;
  } finally {
    if (electronApp) {
      await electronApp
        .close()
        .catch(() => {});
    }

    viteProcess.kill();

    fs.rmSync(
      userDataDir,
      {
        recursive: true,
        force: true
      }
    );
  }
}

main().catch(
  (error) => {
    console.error(
      "Playwright Electron E2E failed:",
      error
    );

    process.exitCode = 1;
  }
);
