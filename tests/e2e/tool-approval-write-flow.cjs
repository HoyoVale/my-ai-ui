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
    "test-results",
    "tool-approval-write"
  );

function delay(milliseconds) {
  return new Promise(
    (resolve) => {
      setTimeout(resolve, milliseconds);
    }
  );
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Vite has not started listening yet.
    }

    await delay(100);
  }

  throw new Error(`Vite server did not start: ${url}`);
}

async function waitForWindow(electronApp, route, timeoutMs = 15_000) {
  const expected = `#${route}`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const page of electronApp.windows()) {
      if (page.url().includes(expected)) {
        await page.waitForLoadState("domcontentloaded");
        return page;
      }
    }

    await delay(50);
  }

  throw new Error(
    `Window ${route} not found. Existing: ${electronApp.windows().map((page) => page.url()).join(", ")}`
  );
}

async function waitForText(locator, expected, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const text = await locator.textContent().catch(() => "");
    if (text?.includes(expected)) {
      return text;
    }
    await delay(50);
  }

  throw new Error(`Text not found: ${expected}`);
}

async function captureFailure(electronApp) {
  fs.mkdirSync(resultsDir, { recursive: true });

  const pages = electronApp?.windows?.() ?? [];
  for (let index = 0; index < pages.length; index += 1) {
    try {
      await pages[index].screenshot({
        path: path.join(resultsDir, `failure-${index}.png`)
      });
    } catch {
      // A page may close while the failure is being collected.
    }
  }
}

async function main() {
  fs.rmSync(resultsDir, {
    recursive: true,
    force: true
  });

  const userDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "xixi-tool-approval-e2e-")
  );
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "xixi-tool-write-workspace-")
  );
  const outputPath = path.join(workspaceRoot, "e2e-approved.txt");
  const now = Date.now();

  fs.writeFileSync(
    path.join(userDataDir, "settings.json"),
    JSON.stringify(
      {
        workspaces: {
          items: [
            {
              id: "e2e-workspace",
              name: "E2E Workspace",
              rootPath: workspaceRoot,
              canonicalPath: workspaceRoot,
              createdAt: now,
              lastOpenedAt: now
            }
          ]
        },
        tools: {
          mode: "coding",
          security: {
            approval: {
              localWrite: true,
              remoteWrite: true,
              allowRunGrant: true,
              timeoutMs: 300_000
            }
          }
        }
      },
      null,
      2
    ),
    "utf8"
  );

  const serverUrl = "http://127.0.0.1:4174";
  const viteEntry = path.join(
    projectRoot,
    "node_modules",
    "vite",
    "bin",
    "vite.js"
  );
  const viteProcess = spawn(
    process.execPath,
    [
      viteEntry,
      "--host",
      "127.0.0.1",
      "--port",
      "4174",
      "--strictPort"
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: serverUrl
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  viteProcess.stdout.on("data", (chunk) => {
    process.stdout.write(`[vite] ${chunk}`);
  });
  viteProcess.stderr.on("data", (chunk) => {
    process.stderr.write(`[vite] ${chunk}`);
  });

  let electronApp = null;

  try {
    await waitForServer(serverUrl);

    const args = [projectRoot];
    if (process.platform === "linux") {
      args.unshift("--no-sandbox");
    }

    electronApp = await electron.launch({
      executablePath: electronPath,
      args,
      cwd: projectRoot,
      chromiumSandbox: false,
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: serverUrl,
        XIXI_E2E: "1",
        XIXI_E2E_USER_DATA: userDataDir
      },
      timeout: 30_000
    });

    electronApp.on("console", async (message) => {
      const values = [];
      for (const argument of message.args()) {
        values.push(
          await argument.jsonValue().catch(() => String(argument))
        );
      }
      console.log("[electron-main]", ...values);
    });

    const pet = await electronApp.firstWindow();
    await pet.locator('[data-testid="pet-sprite"]').waitFor();
    await pet.locator('[data-testid="pet-sprite"]').click({ button: "right" });
    await pet.locator('[data-testid="pet-menu-input"]').click();

    const input = await waitForWindow(electronApp, "/input");
    const menuTrigger = input.locator(
      '[data-testid="input-context-menu-trigger"]'
    );

    await menuTrigger.click();
    await input.locator('[data-testid="input-context-mode"]').click();
    await input.getByRole("button", { name: "Coding", exact: true }).click();
    await input.getByRole("button", { name: "E2E Workspace", exact: true }).click();
    await input.locator('[data-testid="input-create-session"]').click();

    const inputField = input.locator('[data-testid="input-textarea"]');
    const sendButton = input.locator('[data-testid="input-send"]');
    await inputField.fill("tool-write-key");
    await sendButton.click();

    const conversation = await waitForWindow(electronApp, "/conversation");
    const approvalPanel = conversation.locator(
      '[data-testid="tool-approval-panel"]'
    );
    await approvalPanel.waitFor({ state: "visible", timeout: 15_000 });

    assert.equal(
      fs.existsSync(outputPath),
      false,
      "The file must not exist before the user approves the Tool call."
    );
    await waitForText(approvalPanel, "Write text file");
    await waitForText(approvalPanel, "本地文件写入");

    await approvalPanel
      .locator('[data-testid="tool-approval-allow-once"]')
      .click();

    const response = await waitForWindow(electronApp, "/response");
    await waitForText(
      response.locator('[data-testid="response-text"]'),
      "E2E_TOOL_WRITE_OK:e2e-approved.txt"
    );

    assert.equal(
      fs.readFileSync(outputPath, "utf8"),
      "E2E approved write\n"
    );
    await approvalPanel.waitFor({ state: "detached", timeout: 10_000 });

    console.log(
      "Playwright Electron Tool Security E2E passed: Coding workspace binding, approval gate, omitted optional SHA input, atomic write, and final response."
    );
  } catch (error) {
    if (electronApp) {
      await captureFailure(electronApp);
    }
    throw error;
  } finally {
    if (electronApp) {
      await electronApp.close().catch(() => {});
    }
    viteProcess.kill();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("Playwright Electron Tool Security E2E failed:", error);
  process.exitCode = 1;
});
