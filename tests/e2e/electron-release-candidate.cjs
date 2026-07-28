const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  capturePages,
  delay,
  getFreePort,
  launchElectronApp,
  startVite,
  stopProcess,
  waitForAttribute,
  waitForCondition,
  waitForServer,
  waitForText,
  waitForWindow,
  windowInventory
} = require("./helpers/electronHarness.cjs");
const {
  createReleaseCandidateReport
} = require("./helpers/releaseCandidateReport.cjs");

const projectRoot = path.resolve(__dirname, "../..");
const reportRoot = path.resolve(
  process.env.CORE_LITE_48_REPORT_DIR ||
    path.join(projectRoot, "test-results", "core-lite-4.8", process.platform)
);
const reportPath = path.join(reportRoot, "electron-release-candidate.json");
const screenshotRoot = path.join(reportRoot, "screenshots");
const userDataDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "my-ai-ui-core-lite-48-")
);
const diagnostics = {
  logs: [],
  mainIssues: [],
  rendererIssues: []
};
const { report, scenario, finish } = createReleaseCandidateReport({
  suite: "core-lite-4.8-electron-release-candidate",
  outputPath: reportPath
});
report.diagnostics = diagnostics;
report.metrics = {
  launches: 0,
  restarts: 0,
  responseReloads: 0,
  responseRecreates: 0,
  conversationRecreates: 0,
  gracefulShutdowns: 0,
  gracefulShutdownMs: [],
  windowInventories: []
};

let viteProcess = null;
let electronApp = null;
let pet = null;
let serverUrl = "";
let input = null;

function routeCount(inventory, route) {
  return inventory.filter((item) => item.url.includes(`#${route}`)).length;
}

function assistantMessages(conversation) {
  return (conversation?.messages ?? [])
    .filter((message) => message?.role === "assistant");
}

async function closeElectronApp({ timeoutMs = 15_000 } = {}) {
  if (!electronApp) return { durationMs: 0, forced: false };
  const current = electronApp;
  electronApp = null;
  pet = null;
  input = null;
  const startedAt = Date.now();
  const closed = await Promise.race([
    current.close().then(() => true).catch(() => true),
    delay(timeoutMs).then(() => false)
  ]);
  if (!closed) {
    current.process()?.kill();
  }
  const durationMs = Date.now() - startedAt;
  report.metrics.gracefulShutdowns += 1;
  report.metrics.gracefulShutdownMs.push(durationMs);
  return { durationMs, forced: !closed };
}

async function launch() {
  const launched = await launchElectronApp({
    projectRoot,
    serverUrl,
    userDataDir,
    diagnostics,
    extraEnv: {
      XIXI_E2E_LONG_STREAM_CHUNKS: "220",
      XIXI_E2E_LONG_STREAM_DELAY_MS: "14"
    }
  });
  electronApp = launched.electronApp;
  pet = launched.pet;
  report.metrics.launches += 1;
  return launched;
}

async function openInput() {
  await pet.evaluate(() => window.api?.openInput?.());
  input = await waitForWindow(electronApp, "/input");
  await input.locator('[data-testid="input-textarea"]').waitFor();
  return input;
}

async function sendFromInput(text, { expectRunning = false } = {}) {
  const field = input.locator('[data-testid="input-textarea"]');
  const button = input.locator('[data-testid="input-send"]');
  await field.fill(text);
  await button.click();
  await waitForCondition(async () => (await field.inputValue()) === "", {
    timeoutMs: 10_000,
    message: "Input text was not accepted"
  });
  if (expectRunning) {
    await waitForAttribute(button, "data-run-state", "running", 10_000);
  }
  return { field, button };
}

async function reloadResponse(page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  report.metrics.responseReloads += 1;
  await waitForText(
    page.locator('[data-testid="response-text"]'),
    "E2E_LONG_STREAM_BEGIN",
    15_000
  );
}

async function recreateResponse(page) {
  const browserWindow = await electronApp.browserWindow(page);
  const previous = page;
  await browserWindow.evaluate((window) => window.close());
  await waitForCondition(() => previous.isClosed(), {
    timeoutMs: 10_000,
    message: "Response window did not close"
  });
  const reopened = await waitForWindow(electronApp, "/response", {
    timeoutMs: 15_000,
    exclude: new Set([previous])
  });
  report.metrics.responseRecreates += 1;
  await waitForText(
    reopened.locator('[data-testid="response-text"]'),
    "E2E_LONG_STREAM_BEGIN",
    15_000
  );
  return reopened;
}

async function recreateConversation() {
  await pet.evaluate(() => window.api?.openConversation?.());
  const previous = await waitForWindow(electronApp, "/conversation");
  const browserWindow = await electronApp.browserWindow(previous);
  await browserWindow.evaluate((window) => window.close());
  await waitForCondition(() => previous.isClosed(), {
    timeoutMs: 10_000,
    message: "Conversation window did not close"
  });
  await pet.evaluate(() => window.api?.openConversation?.());
  const reopened = await waitForWindow(electronApp, "/conversation", {
    timeoutMs: 15_000,
    exclude: new Set([previous])
  });
  await reopened.locator('[data-testid="conversation-message-list"]').waitFor();
  report.metrics.conversationRecreates += 1;
  return reopened;
}

async function readState(page = pet) {
  return page.evaluate(async () => window.api?.getConversationState?.());
}

async function readCurrentConversation(page = pet) {
  const state = await readState(page);
  const conversationId = String(state?.currentConversationId ?? "").trim();
  assert.notEqual(
    conversationId,
    "",
    "Conversation state did not expose a current conversation id"
  );
  const conversation = await page.evaluate(
    async (id) => window.api?.getConversation?.(id),
    conversationId
  );
  assert.ok(
    conversation,
    `Conversation ${conversationId} could not be loaded`
  );
  return conversation;
}

async function assertNoDuplicateWindows(label) {
  const inventory = await windowInventory(electronApp);
  report.metrics.windowInventories.push({
    label,
    at: new Date().toISOString(),
    windows: inventory
  });
  for (const route of ["/pet", "/input", "/response", "/conversation"]) {
    assert.equal(
      routeCount(inventory, route) <= 1,
      true,
      `Duplicate ${route} windows after ${label}`
    );
  }
  return inventory;
}

async function main() {
  fs.rmSync(reportRoot, { recursive: true, force: true });
  fs.mkdirSync(reportRoot, { recursive: true });

  try {
    const port = await getFreePort();
    const vite = startVite({ projectRoot, port, logs: diagnostics.logs });
    viteProcess = vite.child;
    serverUrl = vite.serverUrl;
    await waitForServer(serverUrl);

    await scenario("long-stream-window-churn", async () => {
      await launch();
      await openInput();
      const { button } = await sendFromInput("e2e-long-stream-complete", {
        expectRunning: true
      });
      let response = await waitForWindow(electronApp, "/response");
      await waitForText(
        response.locator('[data-testid="response-text"]'),
        "E2E_LONG_STREAM_BEGIN:e2e-long-stream-complete",
        15_000
      );

      await reloadResponse(response);
      await recreateConversation();
      response = await recreateResponse(response);
      await reloadResponse(response);

      const finalText = await waitForText(
        response.locator('[data-testid="response-text"]'),
        "E2E_LONG_STREAM_END:e2e-long-stream-complete",
        30_000
      );
      await waitForAttribute(button, "data-run-state", "idle", 20_000);
      assert.match(finalText, /E2E_LONG_STREAM_LINE_180/u);

      const conversation = await readCurrentConversation();
      const assistants = assistantMessages(conversation);
      assert.equal(assistants.length >= 1, true);
      assert.match(
        String(assistants.at(-1)?.content ?? ""),
        /E2E_LONG_STREAM_END:e2e-long-stream-complete/u
      );
      const inventory = await assertNoDuplicateWindows("completed-window-churn");
      return {
        assistantMessages: assistants.length,
        finalTextLength: finalText.length,
        windowCount: inventory.length
      };
    });

    await scenario("graceful-restart-persists-completed-run", async () => {
      const shutdown = await closeElectronApp();
      assert.equal(shutdown.forced, false, "Electron required a forced shutdown");
      assert.equal(shutdown.durationMs < 15_000, true);

      await launch();
      report.metrics.restarts += 1;
      const conversation = await readCurrentConversation();
      const assistants = assistantMessages(conversation);
      assert.match(
        String(assistants.at(-1)?.content ?? ""),
        /E2E_LONG_STREAM_END:e2e-long-stream-complete/u
      );
      await assertNoDuplicateWindows("first-restart");
      return {
        shutdownDurationMs: shutdown.durationMs,
        persistedAssistantMessages: assistants.length
      };
    });

    await scenario("shutdown-during-stream-recovers-cancelled-terminal", async () => {
      await openInput();
      await sendFromInput("e2e-long-stream-shutdown", {
        expectRunning: true
      });
      const response = await waitForWindow(electronApp, "/response");
      await waitForText(
        response.locator('[data-testid="response-text"]'),
        "E2E_LONG_STREAM_BEGIN:e2e-long-stream-shutdown",
        15_000
      );
      await waitForText(
        response.locator('[data-testid="response-text"]'),
        "E2E_LONG_STREAM_LINE_010",
        15_000
      );

      const shutdown = await closeElectronApp();
      assert.equal(shutdown.forced, false, "Active run shutdown required force");
      assert.equal(shutdown.durationMs < 15_000, true);

      await launch();
      report.metrics.restarts += 1;
      const conversation = await readCurrentConversation();
      const messages = conversation?.messages ?? [];
      const userIndex = messages.findLastIndex(
        (message) => message?.role === "user" &&
          message?.content === "e2e-long-stream-shutdown"
      );
      assert.equal(userIndex >= 0, true);
      const assistant = messages.slice(userIndex + 1)
        .find((message) => message?.role === "assistant");
      assert.ok(assistant, "Cancelled assistant message was not persisted");
      assert.equal(assistant?.metadata?.run?.terminal?.code, "cancelled");
      assert.equal(assistant?.metadata?.run?.resumable, false);
      assert.match(String(assistant?.content ?? ""), /本次任务已取消/u);

      const status = await pet.evaluate(
        async () => window.api?.getAgentStatus?.()
      );
      assert.equal(["idle", "completed", "cancelled"].includes(status?.state), true);
      await assertNoDuplicateWindows("cancelled-restart");
      return {
        shutdownDurationMs: shutdown.durationMs,
        terminalCode: assistant.metadata.run.terminal.code,
        partialTextLength: String(assistant.content ?? "").length
      };
    });

    await scenario("post-restart-run-has-no-stale-listeners", async () => {
      await openInput();
      const { button } = await sendFromInput("release-candidate-final-check");
      const response = await waitForWindow(electronApp, "/response");
      const text = await waitForText(
        response.locator('[data-testid="response-text"]'),
        "E2E_REPLY_",
        20_000
      );
      await waitForAttribute(button, "data-run-state", "idle", 15_000);
      assert.match(text, /release-candidate-final-check/u);
      const inventory = await assertNoDuplicateWindows("post-restart-run");
      return {
        responseText: text,
        windowCount: inventory.length
      };
    });

    const pageErrors = diagnostics.rendererIssues.filter(
      (entry) => ["renderer-pageerror", "renderer-crash"].includes(entry.source)
    );
    const mainErrors = diagnostics.mainIssues.filter(
      (entry) => entry.type === "error"
    );
    assert.deepEqual(pageErrors, [], "Renderer page error or crash detected");
    assert.deepEqual(mainErrors, [], "Electron main process error detected");

    await closeElectronApp();
    finish();
    console.log(
      `Core Lite 4.8 Electron release candidate passed. Report: ${reportPath}`
    );
  } catch (error) {
    if (electronApp) {
      await capturePages(electronApp, screenshotRoot, "electron-rc-failure");
    }
    finish(error);
    throw error;
  } finally {
    await closeElectronApp().catch(() => {});
    await stopProcess(viteProcess).catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("Core Lite 4.8 Electron release candidate failed:", error);
  process.exitCode = 1;
});
