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

async function waitForConversationModel(
  page,
  expectedModelId,
  timeoutMs = 15000
) {
  const deadline =
    Date.now() +
    timeoutMs;

  while (
    Date.now() <
    deadline
  ) {
    const state =
      await page.evaluate(
        async () => window.api
          ?.getConversationState?.()
      );
    const modelId =
      state?.currentConversation
        ?.modelSnapshot
        ?.modelId ??
      state?.currentModel
        ?.modelId;

    if (modelId === expectedModelId) {
      return state;
    }

    await delay(50);
  }

  throw new Error(
    `Conversation model did not become ${expectedModelId}.`
  );
}

async function revealDetails(locator) {
  await locator.waitFor({
    state: "attached"
  });

  const isOpen = await locator.evaluate(
    (element) => element.open
  );

  if (!isOpen) {
    await locator
      .locator(
        ":scope > summary"
      )
      .click();
  }

  await locator
    .locator(
      ":scope > .tool-manifest-card__body"
    )
    .waitFor({
      state: "visible"
    });
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

    await inputMenuTrigger.waitFor({ state: "visible" });
    assert.equal(
      await inputMenuTrigger.getAttribute("aria-label"),
      "会话与模型"
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
      openInputBounds.width,
      closedInputBounds.width
    );

    const closedInputBottom =
      closedInputBounds.y +
      closedInputBounds.height;
    const openInputBottom =
      openInputBounds.y +
      openInputBounds.height;
    const keepsTopAnchor =
      Math.abs(
        openInputBounds.y -
          closedInputBounds.y
      ) <= 1;
    const keepsBottomAnchor =
      Math.abs(
        openInputBottom -
          closedInputBottom
      ) <= 1;

    assert.ok(
      keepsTopAnchor ||
        keepsBottomAnchor,
      "opening the input menu should preserve either the top or bottom edge"
    );

    if (keepsTopAnchor) {
      assert.ok(
        openInputBottom >
          closedInputBottom
      );
    } else {
      assert.ok(
        openInputBounds.y <
          closedInputBounds.y
      );
    }

    await input.keyboard.press(
      "Escape"
    );

    await waitForAttribute(
      inputMenuTrigger,
      "aria-expanded",
      "false"
    );

    await inputField.fill("/");

    const slashMenu = input.locator(
      '[data-testid="input-slash-menu"]'
    );

    await slashMenu.waitFor();

    let slashMenuText = "";
    let slashSkillCount = 0;
    let slashCommandCount = 0;
    const slashDeadline = Date.now() + 15000;

    while (Date.now() < slashDeadline) {
      slashMenuText = await slashMenu.textContent().catch(() => "");
      slashSkillCount = Number(
        await slashMenu.getAttribute("data-skill-count")
      ) || 0;
      slashCommandCount = Number(
        await slashMenu.getAttribute("data-command-count")
      ) || 0;

      if (
        slashCommandCount > 0 ||
        slashSkillCount > 0 ||
        slashMenuText.includes("可用 Skill") ||
        slashMenuText.includes("无法读取 Skill")
      ) {
        break;
      }

      await delay(50);
    }

    assert.ok(
      slashCommandCount > 0 ||
      slashSkillCount > 0 ||
      slashMenuText.includes("可用 Skill") ||
      slashMenuText.includes("无法读取 Skill"),
      "输入 / 后应显示应用命令、Skill 建议或加载状态"
    );

    assert.equal(
      await inputField.inputValue(),
      "/",
      "打开 Slash 菜单后输入内容不应丢失"
    );
    assert.equal(
      await inputField.isVisible(),
      true,
      "打开 Slash 菜单后 Input Renderer 不应消失"
    );

    await inputField.fill("/go");
    await input
      .locator('[data-testid="input-slash-command-goal"]')
      .click();
    await input
      .locator('[data-testid="input-context-menu-panel"]')
      .waitFor({ state: "visible" });
    await input
      .locator('[data-testid="input-goal-criteria"]')
      .waitFor({ state: "visible" });
    assert.equal(await inputField.inputValue(), "");
    await input.keyboard.press("Escape");

    for (let index = 0; index < 3; index += 1) {
      await input.keyboard.press("Escape");
      await slashMenu.waitFor({ state: "hidden" });
      await inputField.fill("");
      await inputField.fill("/");
      await slashMenu.waitFor({ state: "visible" });
      assert.equal(
        await inputField.isVisible(),
        true,
        "重复打开 Slash 菜单不应触发布局更新循环"
      );
    }

    await input.keyboard.press("Escape");
    await slashMenu.waitFor({ state: "hidden" });

    // Slash emits a one-shot close request for the context menu. Once that
    // request is consumed, the + menu must remain usable on every later open.
    for (let index = 0; index < 3; index += 1) {
      await inputMenuTrigger.click();
      await input
        .locator('[data-testid="input-context-menu-panel"]')
        .waitFor({ state: "visible" });
      await waitForAttribute(inputMenuTrigger, "aria-expanded", "true");
      await input.keyboard.press("Escape");
      await waitForAttribute(inputMenuTrigger, "aria-expanded", "false");
    }

    assert.equal(
      await slashMenu.count(),
      0,
      "关闭 + 菜单后不应在未编辑输入时重新抢占 Slash 菜单"
    );

    await inputField.fill("");

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

    await conversation
      .locator('[data-testid="conversation-goal-toggle"]')
      .click();

    const goalPanel = conversation.locator(
      '[data-testid="conversation-goal-panel"]'
    );
    await goalPanel.waitFor({ state: "visible" });

    await goalPanel
      .locator('[data-testid="conversation-goal-objective"]')
      .fill("E2E Goal：保持当前会话可用，并通过验证。");
    await goalPanel
      .locator('[data-testid="conversation-goal-criteria"]')
      .fill("E2E 测试全部通过\n人工确认 Goal 面板可用");
    assert.equal(
      await goalPanel.locator('[data-testid="conversation-goal-auto-continue"]').isChecked(),
      true
    );
    await goalPanel
      .locator('[data-testid="conversation-goal-save"]')
      .click();
    await waitForText(
      goalPanel.locator(".conversation-inspector__header"),
      "进行中"
    );

    const manualCriterionButton =
      goalPanel
        .locator(
          ".conversation-goal-criterion-actions button"
        )
        .filter({
          hasText: "确认完成"
        });

    await manualCriterionButton.waitFor({
      state: "visible"
    });

    const goalLayout =
      await goalPanel.evaluate(
        (panel) => {
          const scroll = panel.querySelector(
            ".conversation-goal-panel__scroll"
          );
          const footer = panel.querySelector(
            ".conversation-goal-panel__footer"
          );
          const manualButton = panel.querySelector(
            ".conversation-goal-criterion-actions button"
          );
          const buttonRect =
            manualButton
              ?.getBoundingClientRect();
          const scrollRect =
            scroll?.getBoundingClientRect();
          const footerRect =
            footer?.getBoundingClientRect();

          return {
            buttonWidth:
              buttonRect?.width ?? 0,
            buttonHeight:
              buttonRect?.height ?? 0,
            buttonWhiteSpace:
              manualButton
                ? getComputedStyle(
                    manualButton
                  ).whiteSpace
                : "",
            regionsDoNotOverlap:
              Boolean(
                scrollRect &&
                footerRect &&
                scrollRect.bottom <=
                  footerRect.top + 1
              ),
            footerInsidePanel:
              Boolean(
                footerRect &&
                footerRect.bottom <=
                  panel
                    .getBoundingClientRect()
                    .bottom + 1
              )
          };
        }
      );

    assert.ok(
      goalLayout.buttonWidth >= 44,
      "Goal 人工确认按钮不应被状态圆点样式压成竖排"
    );
    assert.ok(
      goalLayout.buttonHeight < 32,
      "Goal 人工确认按钮应保持单行高度"
    );
    assert.equal(
      goalLayout.buttonWhiteSpace,
      "nowrap"
    );
    assert.equal(
      goalLayout.regionsDoNotOverlap,
      true,
      "Goal 底部操作栏不应覆盖滚动内容"
    );
    assert.equal(
      goalLayout.footerInsidePanel,
      true,
      "Goal 底部操作栏必须始终留在面板内"
    );

    await goalPanel
      .locator('[data-testid="conversation-goal-pause"]')
      .click();
    await waitForText(
      goalPanel.locator(".conversation-inspector__header"),
      "已暂停"
    );

    await goalPanel
      .locator('[data-testid="conversation-goal-save"]')
      .click();
    await waitForText(
      goalPanel.locator(".conversation-inspector__header"),
      "进行中"
    );

    await goalPanel
      .locator('[data-testid="conversation-goal-clear"]')
      .click();
    await waitForText(
      goalPanel.locator(".conversation-inspector__header"),
      "未设置"
    );
    await conversation
      .locator('[data-testid="conversation-goal-toggle"]')
      .click();
    await goalPanel.waitFor({ state: "hidden" });

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

    assert.equal(
      await conversation
        .locator(
          '[data-testid="conversation-recovery-toggle"]'
        )
        .count(),
      0,
      "恢复中心入口不应向普通用户显示"
    );

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
        '[data-testid="conversation-create-none"]'
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

    await conversation.bringToFront();

    assert.equal(
      await conversation.locator('[data-testid="conversation-recovery-toggle"]').count(),
      0,
      "已删除的全局 Tool Runtime 恢复入口不应在开发者模式重新出现"
    );

    await setting.bringToFront();

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
      .locator('[data-testid="mcp-add-connection"]')
      .click();

    await setting
      .locator('[data-testid="mcp-add-local"]')
      .click();

    const localMcpCard = setting.locator(
      '[data-testid="mcp-server-local-mcp"]'
    );
    await localMcpCard.waitFor();
    await waitForText(localMcpCard, "本地 MCP");
    await waitForText(localMcpCard, "只读");

    const mcpArguments = setting.locator(
      '[data-testid="mcp-args-local-mcp"]'
    );

    await mcpArguments.fill("--first");
    await delay(520);
    await mcpArguments.press("End");
    await mcpArguments.press("Enter");
    await delay(520);
    await mcpArguments.type("--second");

    assert.equal(
      await mcpArguments.inputValue(),
      "--first\n--second",
      "结构化设置文本框应允许在自动保存期间继续输入新行"
    );

    const mcpEnvironment = setting.locator(
      '[data-testid="mcp-env-local-mcp"]'
    );

    await mcpEnvironment.fill("GREETING=hello");
    await delay(520);
    await mcpEnvironment.press("End");
    await mcpEnvironment.type(" ");
    await delay(520);
    await mcpEnvironment.type("world");

    assert.equal(
      await mcpEnvironment.inputValue(),
      "GREETING=hello world",
      "自动规范化不应吞掉用户正在输入的空格"
    );

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

    await revealDetails(calculatorToolCard);

    const calculatorOverride =
      calculatorToolCard.locator(
        '[data-testid="tool-override-calculator"]'
      );

    await calculatorOverride.waitFor({
      state: "visible"
    });

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

    const personalityName = setting.locator(
      '[data-testid="personality-name"]'
    );

    await personalityName.fill("Nova");
    await delay(520);
    await personalityName.press("End");
    await personalityName.type(" ");
    await delay(520);
    await personalityName.type("Assistant");

    assert.equal(
      await personalityName.inputValue(),
      "Nova Assistant",
      "普通文本设置不应在保存回写时丢失空格"
    );

    const personalityInstructions = setting.locator(
      '[data-testid="personality-instructions"]'
    );

    await personalityInstructions.fill("First line");
    await delay(520);
    await personalityInstructions.press("End");
    await personalityInstructions.press("Enter");
    await delay(520);
    await personalityInstructions.type("Second line");

    assert.equal(
      await personalityInstructions.inputValue(),
      "First line\nSecond line",
      "多行设置不应在保存回写时丢失换行"
    );

    await personalityName.fill("Nova");

    const responsePreferences = setting.locator(
      '[data-testid="personality-response-preferences"]'
    );
    await responsePreferences.fill("跟随用户使用的语言；语气专业；复杂问题提供完整细节。");
    await delay(520);
    await responsePreferences.press("End");
    await responsePreferences.press("Enter");
    await responsePreferences.type("先给结论，再给证据。");
    assert.equal(
      await responsePreferences.inputValue(),
      "跟随用户使用的语言；语气专业；复杂问题提供完整细节。\n先给结论，再给证据。",
      "自由回复偏好输入不应丢失空格或换行"
    );

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
      "E2E_PERSONALITY:Nova:natural:balanced"
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

    const modelIdInput = setting.locator(
      '[data-testid="model-id-input"]'
    );

    await modelIdInput.fill("");
    await delay(420);
    await modelIdInput.type("e2e-model");

    assert.equal(
      await modelIdInput.inputValue(),
      "e2e-model",
      "必填设置在暂时清空时不应被旧值回写，导致无法重新输入"
    );

    await setting
      .locator(
        '[data-testid="model-context-limit"]'
      )
      .selectOption("128000");

    await setting
      .locator(
        '[data-testid="setting-save-status"][data-status="saved"]'
      )
      .waitFor({
        state: "visible",
        timeout: 15000
      });

    const savedE2EModel =
      await pet.evaluate(
        async () => {
          const settings =
            await window.api
              ?.getSettings?.();
          const provider =
            settings?.model
              ?.providers
              ?.ollama;

          return provider?.models?.find(
            (model) =>
              model.modelId ===
              "e2e-model"
          ) ?? null;
        }
      );

    assert.deepEqual(
      {
        name: savedE2EModel?.name,
        modelId: savedE2EModel?.modelId,
        contextTokenBudget:
          savedE2EModel
            ?.contextTokenBudget
      },
      {
        name: "E2E Model",
        modelId: "e2e-model",
        contextTokenBudget: 128000
      },
      "模型配置必须先完整提交到主进程，再切换当前会话"
    );

    await setting
      .locator(
        '[data-testid="main-model-assignment"]'
      )
      .selectOption({
        label: "Ollama · E2E Model"
      });

    await waitForConversationModel(
      pet,
      "e2e-model"
    );

    const createdWithE2EModel =
      await pet.evaluate(
        async () => {
          return window.api
            ?.createConversation?.();
        }
      );

    assert.equal(
      createdWithE2EModel
        ?.conversation
        ?.modelSnapshot
        ?.modelId,
      "e2e-model",
      "新会话应继承已经明确选择的当前会话模型"
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
        '[data-testid="appearance-latin-font-family"]'
      )
      .fill("Georgia");

    await setting
      .locator(
        '[data-testid="appearance-chinese-font-family"]'
      )
      .fill("Source Han Serif SC");

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
