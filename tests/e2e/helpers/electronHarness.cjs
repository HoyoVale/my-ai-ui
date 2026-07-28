const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { _electron: electron } = require("playwright");
const electronPath = require("electron");

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address
        ? address.port
        : 0;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is not listening yet.
    }
    await delay(100);
  }
  throw new Error(`Vite server did not start: ${url}`);
}

async function waitForCondition(callback, {
  timeoutMs = 15_000,
  intervalMs = 50,
  message = "Condition was not met"
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await callback();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  if (lastError) {
    throw new Error(`${message}: ${lastError.message}`, { cause: lastError });
  }
  throw new Error(message);
}

async function waitForWindow(electronApp, route, {
  timeoutMs = 15_000,
  exclude = new Set()
} = {}) {
  const expected = `#${route}`;
  return waitForCondition(async () => {
    for (const page of electronApp.windows()) {
      if (exclude.has(page) || page.isClosed()) continue;
      if (!page.url().includes(expected)) continue;
      await page.waitForLoadState("domcontentloaded");
      return page;
    }
    return null;
  }, {
    timeoutMs,
    message: `Window ${route} not found. Existing: ${electronApp.windows().map((page) => page.url()).join(", ")}`
  });
}

async function waitForText(locator, expected, timeoutMs = 20_000) {
  return waitForCondition(async () => {
    const text = await locator.textContent().catch(() => "");
    return text?.includes(expected) ? text : null;
  }, {
    timeoutMs,
    message: `Text not found: ${expected}`
  });
}

async function waitForAttribute(locator, name, expected, timeoutMs = 20_000) {
  await waitForCondition(async () => (
    await locator.getAttribute(name).catch(() => null)
  ) === expected, {
    timeoutMs,
    message: `Attribute ${name} did not become ${expected}`
  });
}

function startVite({ projectRoot, port, logs }) {
  const serverUrl = `http://127.0.0.1:${port}`;
  const viteEntry = path.join(
    projectRoot,
    "node_modules",
    "vite",
    "bin",
    "vite.js"
  );
  const child = spawn(
    process.execPath,
    [
      viteEntry,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort"
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: serverUrl
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    }
  );
  const record = (stream, chunk) => {
    const value = String(chunk ?? "");
    logs?.push({ source: `vite-${stream}`, value, at: new Date().toISOString() });
    const target = stream === "stderr" ? process.stderr : process.stdout;
    target.write(`[vite] ${value}`);
  };
  child.stdout.on("data", (chunk) => record("stdout", chunk));
  child.stderr.on("data", (chunk) => record("stderr", chunk));
  return { child, serverUrl };
}

async function stopProcess(child, timeoutMs = 5_000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  const completed = await Promise.race([
    exited.then(() => true),
    delay(timeoutMs).then(() => false)
  ]);
  if (!completed && child.exitCode === null) {
    child.kill("SIGKILL");
    await Promise.race([exited, delay(2_000)]);
  }
}

function serializeConsoleValue(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function attachPageDiagnostics(page, diagnostics) {
  if (page.__coreLite48DiagnosticsAttached) return;
  page.__coreLite48DiagnosticsAttached = true;
  page.on("console", (message) => {
    const entry = {
      source: "renderer-console",
      route: page.url(),
      type: message.type(),
      value: message.text(),
      at: new Date().toISOString()
    };
    diagnostics.logs.push(entry);
    if (["error", "warning"].includes(message.type())) {
      diagnostics.rendererIssues.push(entry);
    }
  });
  page.on("pageerror", (error) => {
    diagnostics.rendererIssues.push({
      source: "renderer-pageerror",
      route: page.url(),
      value: error?.stack ?? error?.message ?? String(error),
      at: new Date().toISOString()
    });
  });
  page.on("crash", () => {
    diagnostics.rendererIssues.push({
      source: "renderer-crash",
      route: page.url(),
      value: "Renderer process crashed",
      at: new Date().toISOString()
    });
  });
}

function attachElectronDiagnostics(electronApp, diagnostics) {
  for (const page of electronApp.windows()) {
    attachPageDiagnostics(page, diagnostics);
  }
  electronApp.on("window", (page) => {
    attachPageDiagnostics(page, diagnostics);
  });
  electronApp.on("console", async (message) => {
    const values = [];
    for (const argument of message.args()) {
      values.push(
        await argument.jsonValue().catch(() => String(argument))
      );
    }
    const value = values.map(serializeConsoleValue).join(" ");
    const entry = {
      source: "electron-main",
      type: message.type(),
      value,
      at: new Date().toISOString()
    };
    diagnostics.logs.push(entry);
    if (["error", "warning"].includes(message.type())) {
      diagnostics.mainIssues.push(entry);
    }
    console.log("[electron-main]", ...values);
  });
}

async function launchElectronApp({
  projectRoot,
  serverUrl,
  userDataDir,
  diagnostics,
  extraEnv = {}
}) {
  const args = [projectRoot];
  if (process.platform === "linux") args.unshift("--no-sandbox");
  const electronApp = await electron.launch({
    executablePath: electronPath,
    args,
    cwd: projectRoot,
    chromiumSandbox: false,
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: serverUrl,
      XIXI_E2E: "1",
      XIXI_E2E_USER_DATA: userDataDir,
      ...extraEnv
    },
    timeout: 30_000
  });
  attachElectronDiagnostics(electronApp, diagnostics);
  const pet = await electronApp.firstWindow();
  await pet.locator('[data-testid="pet-sprite"]').waitFor({ timeout: 20_000 });
  return { electronApp, pet };
}

async function capturePages(electronApp, directory, prefix = "failure") {
  fs.mkdirSync(directory, { recursive: true });
  const pages = electronApp?.windows?.() ?? [];
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    if (page.isClosed()) continue;
    try {
      await page.screenshot({
        path: path.join(directory, `${prefix}-${index}.png`),
        fullPage: true
      });
    } catch {
      // A fault scenario may close a page during capture.
    }
  }
}

async function windowInventory(electronApp) {
  return electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows().map((window) => ({
      id: window.id,
      destroyed: window.isDestroyed(),
      visible: window.isVisible(),
      url: window.webContents.isDestroyed() ? "" : window.webContents.getURL()
    }))
  ));
}

module.exports = {
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
};
