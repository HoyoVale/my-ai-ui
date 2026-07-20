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

async function ensureModelProvider(
  setting,
  providerId
) {
  const providerSelect =
    setting.locator(
      '[data-testid="model-provider-select"]'
    );

  if (
    await providerSelect.count() > 0
  ) {
    const configuredProviders =
      await providerSelect
        .locator("option")
        .evaluateAll(
          (options) =>
            options.map(
              (option) =>
                option.value
            )
        );

    if (
      configuredProviders.includes(
        providerId
      )
    ) {
      await providerSelect
        .selectOption(providerId);

      return;
    }

    const addSection =
      setting.locator(
        '[data-testid="model-provider-add-section"]'
      );

    if (
      await addSection.count() > 0 &&
      await addSection.getAttribute("open") === null
    ) {
      await addSection
        .locator("summary")
        .click();
    }
  }

  const templateSelect =
    setting.locator(
      '[data-testid="model-provider-template-select"]'
    );

  await templateSelect.waitFor({
    state: "visible",
    timeout: 15000
  });

  await templateSelect
    .selectOption(providerId);

  await setting
    .locator(
      '[data-testid="model-provider-add"]'
    )
    .click();

  await providerSelect.waitFor({
    state: "visible",
    timeout: 15000
  });

  await providerSelect
    .selectOption(providerId);
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

    const inputMenuTrigger =
      input.locator(
        '[data-testid="input-context-menu-trigger"]'
      );

    assert.equal(
      await inputMenuTrigger
        .locator("svg")
        .count(),
      1
    );

    const inputBrowserWindow =
      await electronApp
        .browserWindow(input);

    await delay(100);

    const closedInputBounds =
      await inputBrowserWindow
        .evaluate(
          (window) =>
            window.getBounds()
        );

    await inputMenuTrigger.click();

    await input
      .locator(
        '[data-testid="input-context-menu-panel"]'
      )
      .waitFor();

    await waitForAttribute(
      inputMenuTrigger,
      "aria-expanded",
      "true"
    );

    await delay(100);

    const openInputBounds =
      await inputBrowserWindow
        .evaluate(
          (window) =>
            window.getBounds()
        );

    assert.ok(
      openInputBounds.height >
        closedInputBounds.height
    );

    assert.equal(
      openInputBounds.y,
      closedInputBounds.y
    );

    assert.ok(
      openInputBounds.y +
        openInputBounds.height >
      closedInputBounds.y +
        closedInputBounds.height
    );

    await input.keyboard.press(
      "Escape"
    );

    await waitForAttribute(
      inputMenuTrigger,
      "aria-expanded",
      "false"
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

    await response
      .locator(
        ".response-bubble .markdown-code-block"
      )
      .waitFor();

    await response
      .locator(
        ".response-bubble .markdown-table-card"
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
        '.conversation-history-item.is-current'
      ),
      "first message"
    );

    await waitForCount(
      conversation.locator(
        '[data-testid="conversation-message"]'
      ),
      4
    );

    const currentHistoryItem =
      conversation.locator(
        '.conversation-history-item.is-current'
      );

    await currentHistoryItem.hover();
    await currentHistoryItem
      .locator(
        '[data-testid="conversation-rename"]'
      )
      .click();

    const renameInput =
      currentHistoryItem.locator(
        '[data-testid="conversation-rename-input"]'
      );

    await renameInput.fill(
      "E2E renamed session"
    );
    await renameInput.press(
      "Enter"
    );

    await waitForText(
      currentHistoryItem,
      "E2E renamed session"
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
        ".markdown-code-block"
      )
      .waitFor();

    await conversation
      .locator(
        ".markdown-table-card"
      )
      .waitFor();

    const latestAssistant =
      conversation
        .locator(
          '[data-testid="conversation-message"][data-role="assistant"]'
        )
        .last();

    await latestAssistant.hover();
    await latestAssistant
      .locator(
        '[data-testid="message-regenerate"]'
      )
      .click();

    await waitForText(
      responseText,
      "E2E_REGENERATED_2:second message"
    );

    await waitForText(
      latestAssistant,
      "E2E_REGENERATED_2:second message"
    );

    await conversation
      .locator(
        '[data-testid="conversation-recovery-toggle"]'
      )
      .click();

    await conversation
      .locator(
        '[data-testid="conversation-recovery-panel"]'
      )
      .waitFor();

    await conversation
      .locator(
        '[data-testid="conversation-recovery-toggle"]'
      )
      .click();

    await conversation
      .locator(
        '[data-testid="conversation-context-toggle"]'
      )
      .click();

    await conversation
      .locator(
        '[data-testid="conversation-context-inspector"]'
      )
      .waitFor();


    const firstAssistantMessage =
      conversation
        .locator(
          '[data-testid="conversation-message"][data-role="assistant"]'
        )
        .first();

    await firstAssistantMessage.hover();
    await firstAssistantMessage
      .locator(
        '[data-testid="message-pin-toggle"]'
      )
      .click();

    await waitForAttribute(
      firstAssistantMessage,
      "data-context-pinned",
      "true"
    );

    const secondAssistantMessage =
      conversation
        .locator(
          '[data-testid="conversation-message"][data-role="assistant"]'
        )
        .nth(1);

    await secondAssistantMessage.hover();
    await secondAssistantMessage
      .locator(
        '[data-testid="message-context-toggle"]'
      )
      .click();

    await waitForAttribute(
      secondAssistantMessage,
      "data-context-included",
      "false"
    );

    await waitForText(
      conversation.locator(
        '[data-testid="context-pinned-count"]'
      ),
      "1"
    );

    assert.equal(
      await conversation
        .locator(
          '[data-testid="context-total-tokens"]'
        )
        .textContent()
        .then(
          (text) =>
            Boolean(text?.trim())
        ),
      true
    );

    assert.equal(
      await conversation
        .locator(
          '.context-breakdown__value em'
        )
        .first()
        .textContent()
        .then(
          (text) =>
            Boolean(
              text?.includes("%")
            )
        ),
      true
    );

    conversation.once(
      "dialog",
      (dialog) => {
        void dialog.accept();
      }
    );

    await conversation
      .locator(
        '[data-testid="conversation-context-reset"]'
      )
      .click();

    await waitForText(
      conversation.locator(
        '[data-testid="context-recent-count"]'
      ),
      "0"
    );

    await conversation
      .locator(
        '[data-testid="conversation-new"]'
      )
      .click();

    await waitForText(
      conversation.locator(
        '.conversation-history-item.is-current'
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
            "E2E renamed session"
        })
        .first();

    await previousConversation
      .locator("button")
      .first()
      .click();

    await waitForText(
      conversation.locator(
        '.conversation-history-item.is-current'
      ),
      "E2E renamed session"
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
        '[data-testid="setting-tab-general"]'
      )
      .click();

    setting.once(
      "dialog",
      (dialog) => {
        void dialog.accept();
      }
    );

    const developerToggle =
      setting.locator(
        '[data-testid="developer-mode"]'
      );

    await developerToggle.click();
    await waitForAttribute(
      developerToggle,
      "aria-checked",
      "true"
    );

    await setting
      .locator(
        '[data-testid="setting-tab-mcp"]'
      )
      .click();

    await waitForText(
      setting.locator(
        ".setting-page__header"
      ),
      "MCP"
    );

    await setting
      .locator('[data-testid="mcp-overview"]')
      .waitFor();

    await setting
      .locator('[data-testid="mcp-add-github"]')
      .click();

    const githubMcpCard = setting.locator(
      '[data-testid="mcp-server-github"]'
    );
    await githubMcpCard.waitFor();
    await waitForText(githubMcpCard, "GitHub");
    await waitForText(githubMcpCard, "只读");

    await setting
      .locator(
        '[data-testid="setting-tab-tools"]'
      )
      .click();

    await waitForText(
      setting.locator(
        ".setting-page__header"
      ),
      "工具"
    );

    await setting
      .locator(
        '[data-testid="setting-tab-workspace"]'
      )
      .click();

    await waitForText(
      setting.locator(
        ".setting-page__header"
      ),
      "工作上下文"
    );

    const modeCards =
      setting.locator(
        ".tool-mode-card"
      );

    await waitForCount(
      modeCards,
      2
    );

    await waitForText(
      modeCards.first(),
      "Chat"
    );

    await waitForText(
      modeCards.nth(1),
      "Coding"
    );

    await setting
      .locator(
        '[data-testid="setting-tab-tools"]'
      )
      .click();

    const developerSettings =
      setting.locator(
        '[data-testid="tool-developer-settings"]'
      );

    await developerSettings
      .locator("summary")
      .first()
      .click();

    await developerSettings
      .locator('[data-testid="circuit-breaker-diagnostics"]')
      .waitFor();

    await developerSettings
      .locator('[data-testid="circuit-breaker-reset-all"]')
      .waitFor();

    const calculatorToolCard =
      setting.locator(
        '[data-testid="tool-manifest-calculator"]'
      );

    await calculatorToolCard.waitFor();

    if (
      await calculatorToolCard.getAttribute("open") === null
    ) {
      await calculatorToolCard
        .locator("summary")
        .first()
        .click();
    }

    const calculatorOverride =
      calculatorToolCard.locator(
        '[data-testid="tool-override-calculator"]'
      );

    await calculatorOverride
      .selectOption("disabled");
    await calculatorOverride
      .selectOption("inherit");

    await setting
      .locator(
        '[data-testid="setting-tab-conversation"]'
      )
      .click();

    await waitForText(
      setting.locator(
        ".setting-page__header"
      ),
      "会话与上下文"
    );

    await waitForText(
      setting.locator(
        ".settings-section"
      ).first(),
      "运行环境上下文"
    );

    const sharePaths =
      setting.locator(
        '[data-testid="share-workspace-paths"]'
      );

    await sharePaths.click();
    await sharePaths.click();

    await setting
      .locator(
        '[data-testid="context-developer-settings"] summary'
      )
      .first()
      .click();

    await setting
      .locator(
        '[data-testid="setting-tab-personality"]'
      )
      .click();

    await waitForText(
      setting.locator(
        ".setting-page__header"
      ),
      "个性"
    );

    await setting
      .locator(
        '[data-testid="personality-name"]'
      )
      .fill("Nova");

    await setting
      .locator(
        '[data-testid="personality-tone"]'
      )
      .selectOption(
        "professional"
      );

    await setting
      .locator(
        '[data-testid="personality-length"]'
      )
      .getByRole(
        "button",
        {
          name: "详细"
        }
      )
      .click();

    await delay(350);

    await pet.evaluate(
      async () => {
        await window.api
          ?.createConversation?.();
      }
    );

    await input.bringToFront();

    await inputField.fill(
      "personality-key"
    );

    await sendButton.click();

    await waitForText(
      responseText,
      "E2E_PERSONALITY:Nova:professional:detailed"
    );

    await waitForAttribute(
      sendButton,
      "aria-label",
      "Send"
    );

    await setting.bringToFront();

    await setting
      .locator(
        '[data-testid="setting-tab-model"]'
      )
      .click();

    await waitForText(
      setting.locator(
        ".setting-page__header"
      ),
      "模型"
    );

    await ensureModelProvider(
      setting,
      "ollama"
    );

    await delay(250);

    await setting
      .locator(
        '[data-testid="model-add"]'
      )
      .click();

    await setting
      .locator(
        '[data-testid="model-display-name"]'
      )
      .fill("E2E Model");

    await setting
      .locator(
        '[data-testid="model-id-input"]'
      )
      .fill("e2e-model");

    await setting
      .locator(
        '[data-testid="model-context-limit"]'
      )
      .selectOption("128000");

    await delay(350);

    await pet.evaluate(
      async () => {
        await window.api
          ?.createConversation?.();
      }
    );

    await input.bringToFront();
    await inputField.fill(
      "model-key"
    );
    await sendButton.click();

    await waitForText(
      responseText,
      "E2E_MODEL:E2E Model:e2e-model:128000"
    );

    await waitForAttribute(
      sendButton,
      "aria-label",
      "Send"
    );

    await setting.bringToFront();

    await setting
      .locator(
        '[data-testid="setting-tab-appearance"]'
      )
      .click();

    await setting
      .locator(
        '[data-testid="appearance-font-family"]'
      )
      .selectOption("serif");

    await delay(250);

    const settingFontFamily =
      await setting
        .locator(".setting-shell")
        .evaluate((element) => {
          return element.style
            .getPropertyValue(
              "--app-font-family"
            );
        });

    assert(
      settingFontFamily.includes(
        "Georgia"
      ),
      "Expected the global serif font family to apply to Setting."
    );

    await pet.evaluate(
      async () => {
        await window.api
          ?.createConversation?.();
      }
    );

    await inputField.fill(
      "latex-key"
    );
    await sendButton.click();

    await response
      .locator(".katex")
      .first()
      .waitFor();

    await waitForAttribute(
      sendButton,
      "aria-label",
      "Send"
    );

    await conversation.bringToFront();
    await conversation
      .locator(".katex")
      .first()
      .waitFor();

    await setting.bringToFront();

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
        '[data-testid="memory-new-topbar"]'
      )
      .click();

    await memory
      .locator(
        '[data-testid="memory-title"]'
      )
      .fill(
        "E2E 测试暗号"
      );

    await memory
      .locator(
        '[data-testid="memory-content"]'
      )
      .fill(
        "memory-key 对应紫色彗星"
      );

    await memory
      .locator(
        '[data-testid="memory-description"]'
      )
      .fill(
        "用于验证长期记忆检索"
      );

    await memory
      .locator(
        '[data-testid="memory-tags"]'
      )
      .fill(
        "e2e, memory-key"
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
      "用于验证长期记忆检索"
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
      "Playwright Electron E2E passed: replies, response re-open, conversation switch, personality context, provider and multi-model selection, global typography, LaTeX rendering, memory metadata, memory injection and memory disable."
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
