import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const script = path.join(
  projectRoot,
  "scripts",
  "create-release-candidate-summary.mjs"
);

function writeReport(root, platform, suite, status = "passed") {
  const directory = path.join(root, platform, suite);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "report.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      suite,
      status,
      platform,
      arch: "x64",
      nodeVersion: process.version,
      durationMs: 10,
      scenarios: suite.includes("electron")
        ? [{ name: "window-churn", status }]
        : undefined
    }, null, 2)}\n`,
    "utf8"
  );
}

function runSummary(root, output, platforms = "linux,win32") {
  return spawnSync(
    process.execPath,
    [
      script,
      `--root=${root}`,
      `--output=${output}`,
      `--require-platforms=${platforms}`
    ],
    {
      cwd: projectRoot,
      encoding: "utf8"
    }
  );
}

test("release summary passes only when both suites exist for both platforms", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "core-lite-48-summary-"));
  const output = path.join(root, "summary.json");
  try {
    for (const platform of ["linux", "win32"]) {
      writeReport(root, platform, "core-lite-lifecycle-soak");
      writeReport(root, platform, "core-lite-4.8-electron-release-candidate");
    }

    const result = runSummary(root, output);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const summary = JSON.parse(fs.readFileSync(output, "utf8"));
    assert.equal(summary.status, "passed");
    assert.equal(summary.reportCount, 4);
    assert.equal(summary.packageLockSha256.length, 64);
    assert.equal(summary.errors.length, 0);
    assert.equal(summary.reports.every((report) => report.sha256.length === 64), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("release summary fails on missing or failed platform evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "core-lite-48-summary-fail-"));
  const output = path.join(root, "summary.json");
  try {
    writeReport(root, "linux", "core-lite-lifecycle-soak");
    writeReport(root, "linux", "core-lite-4.8-electron-release-candidate", "failed");

    const result = runSummary(root, output);
    assert.equal(result.status, 1);
    const summary = JSON.parse(fs.readFileSync(output, "utf8"));
    assert.equal(summary.status, "failed");
    assert.match(summary.errors.join("\n"), /win32/u);
    assert.match(summary.errors.join("\n"), /did not pass/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
