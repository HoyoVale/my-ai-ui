import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function read(relativePath) {
  return fs.readFileSync(
    new URL(`../../${relativePath}`, import.meta.url),
    "utf8"
  );
}

test("Core Lite keeps deterministic stress commands while 4.8 owns the release gate", () => {
  const packageJson = JSON.parse(read("package.json"));
  assert.match(
    packageJson.scripts["test:core-lite4.7"],
    /runtimeFaultInjection\.test\.js/u
  );
  assert.match(
    packageJson.scripts["test:stress:core-lite4.7"],
    /core-lite-lifecycle-soak\.mjs/u
  );
  assert.match(
    packageJson.scripts["test:soak:core-lite4.7"],
    /core-lite-lifecycle-soak\.mjs/u
  );
  assert.match(
    packageJson.scripts["check:full"],
    /test:stress:core-lite4\.8/u
  );
});

test("persistence shutdown flush has a hard timeout and counts active writes", () => {
  const source = read("electron/persistence/AsyncPersistenceQueue.js");
  assert.match(source, /attemptTimeoutMs\s*=\s*2000/u);
  assert.match(source, /!queue\.isIdle\(\)/u);
  assert.match(source, /PERSISTENCE_FLUSH_TIMEOUT/u);
  assert.match(source, /timedOutCount/u);
});

test("Response renderer reloads replay one bounded snapshot instead of queued chunks", () => {
  const controller = read(
    "electron/windows/response/ResponseWindowController.js"
  );
  const replay = read(
    "electron/windows/response/ResponseStreamReplayBuffer.js"
  );

  assert.match(controller, /this\.streamReplay\.replayMessages/u);
  assert.match(controller, /this\.maxPendingMessages\s*=\s*32/u);
  assert.match(controller, /isStreamChannel/u);
  assert.match(replay, /maxTextLength\s*=\s*4_000_000/u);
  assert.match(replay, /STREAM_REPLACE/u);
});

test("subprocess shutdown rechecks abort and shares one termination request", () => {
  const source = read("electron/tools/process/SubprocessSupervisor.js");
  assert.match(source, /if \(abortSignal\?\.aborted\) \{\s*onAbort\(\)/u);
  assert.match(source, /entry\.terminationPromise/u);
  assert.match(source, /entry\.requestTermination\(reason, \{ force: true \}\)/u);
});

test("CI runs the Core Lite 4.8 lifecycle stress gate", () => {
  const workflow = read(".github/workflows/ci.yml");
  assert.match(workflow, /Core Lite lifecycle fault injection/u);
  assert.match(workflow, /npm run test:stress:core-lite4\.8/u);
});
