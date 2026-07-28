import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function read(relativePath) {
  return fs.readFileSync(
    new URL(`../../${relativePath}`, import.meta.url),
    "utf8"
  );
}

test("Core Lite 4.8 exposes release-candidate and report commands", () => {
  const packageJson = JSON.parse(read("package.json"));
  const scripts = packageJson.scripts ?? {};
  assert.match(
    scripts["test:core-lite4.8"],
    /electronReleaseCandidateContract\.test\.js/u
  );
  assert.match(
    scripts["test:e2e:electron-rc"],
    /electron-release-candidate\.cjs/u
  );
  assert.match(
    scripts["test:stress:core-lite4.8"],
    /--report=test-results\/core-lite-4\.8/u
  );
  assert.match(
    scripts["test:soak:core-lite4.8"],
    /--seconds=1800/u
  );
  assert.match(
    scripts["check:full"],
    /test:e2e:electron-rc/u
  );
});

test("release candidate E2E churns real windows and restarts one userData profile", () => {
  const source = read("tests/e2e/electron-release-candidate.cjs");
  assert.match(source, /e2e-long-stream-complete/u);
  assert.match(source, /page\.reload/u);
  assert.match(source, /window\.close/u);
  assert.match(source, /report\.metrics\.responseRecreates/u);
  assert.match(source, /report\.metrics\.conversationRecreates/u);
  assert.match(source, /e2e-long-stream-shutdown/u);
  assert.match(source, /terminal\?\.code, "cancelled"/u);
  const harness = read("tests/e2e/helpers/electronHarness.cjs");
  assert.match(harness, /XIXI_E2E_USER_DATA/u);
});


test("release candidate reads full messages through the conversation detail API", () => {
  const source = read("tests/e2e/electron-release-candidate.cjs");
  assert.match(source, /currentConversationId/u);
  assert.match(source, /getConversation\?\.\(id\)/u);
  assert.match(source, /readCurrentConversation\(\)/u);
  assert.doesNotMatch(source, /currentConversation\?\.messages/u);
});

test("release candidate observes stable send-button run state instead of localized labels", () => {
  const composer = read("src/Input/components/Composer.jsx");
  const releaseCandidate = read("tests/e2e/electron-release-candidate.cjs");
  assert.match(composer, /data-run-state=\{isStopping \? "stopping" : isRunning \? "running" : "idle"\}/u);
  assert.match(releaseCandidate, /"data-run-state", "running"/u);
  assert.match(releaseCandidate, /"data-run-state", "idle"/u);
  assert.doesNotMatch(releaseCandidate, /"aria-label", "Stop"/u);
});

test("long E2E streaming removes abort listeners and stays configurable", () => {
  const driver = read("electron/agent/e2eAgentDriver.js");
  assert.match(driver, /XIXI_E2E_LONG_STREAM_CHUNKS/u);
  assert.match(driver, /XIXI_E2E_LONG_STREAM_DELAY_MS/u);
  assert.match(driver, /removeEventListener\(\s*"abort"/u);
  assert.match(driver, /E2E_LONG_STREAM_END/u);
});

test("CI runs the Electron release candidate on Windows and Linux and always archives reports", () => {
  const workflow = read(".github/workflows/ci.yml");
  assert.match(workflow, /Real Electron release candidate \(Linux\)/u);
  assert.match(workflow, /Real Electron release candidate \(Windows\)/u);
  assert.match(workflow, /npm run test:e2e:electron-rc/u);
  assert.match(workflow, /if: always\(\)/u);
  assert.match(workflow, /core-lite-4\.8/u);
  assert.match(workflow, /release-candidate:/u);
  assert.match(workflow, /actions\/download-artifact@v4/u);
  assert.match(workflow, /--require-platforms=linux,win32/u);
});

test("scheduled soak writes and archives a machine-readable lifecycle report", () => {
  const workflow = read(".github/workflows/runtime-soak.yml");
  const soak = read("tests/performance/core-lite-lifecycle-soak.mjs");
  assert.match(workflow, /core-lite-lifecycle-soak\.mjs/u);
  assert.match(workflow, /actions\/upload-artifact@v4/u);
  assert.match(workflow, /if: always\(\)/u);
  assert.match(soak, /CORE_LITE_STRESS_REPORT/u);
  assert.match(soak, /schemaVersion:\s*1/u);
  assert.match(soak, /status:\s*"failed"/u);
});

test("release candidate summary requires both evidence suites and hashes the lockfile", () => {
  const source = read("scripts/create-release-candidate-summary.mjs");
  const packageJson = JSON.parse(read("package.json"));
  assert.match(source, /core-lite-lifecycle-soak/u);
  assert.match(source, /core-lite-4\.8-electron-release-candidate/u);
  assert.match(source, /packageLockSha256/u);
  assert.match(source, /require-platforms/u);
  assert.match(packageJson.scripts["report:core-lite4.8"], /create-release-candidate-summary/u);
  assert.match(packageJson.scripts["check:full"], /report:core-lite4\.8/u);
});
