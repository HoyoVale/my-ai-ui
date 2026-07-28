import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8")
);
const tooling = packageJson.releaseTooling ?? {};

const builder = String(tooling.electronBuilder ?? "").trim();
const updater = String(tooling.electronUpdater ?? "").trim();

if (!builder || !updater) {
  throw new Error("package.json releaseTooling versions are missing.");
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(
  npmCommand,
  [
    "install",
    "--no-save",
    "--package-lock=false",
    "--no-audit",
    "--no-fund",
    `electron-builder@${builder}`,
    `electron-updater@${updater}`
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      npm_config_registry:
        process.env.npm_config_registry ??
        "https://registry.npmjs.org/"
    }
  }
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(
  `Release tooling ready: electron-builder ${builder}, electron-updater ${updater}.`
);
