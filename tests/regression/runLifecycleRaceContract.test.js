import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("Core Lite 4.6 grants one finalizer and awaits resource disposal", () => {
  const finalization = read("electron/agent/finalization/AgentRunFinalization.js");
  const execution = read("electron/agent/execution/AgentRunExecution.js");

  assert.match(finalization, /async finalizeRun\(/u);
  assert.match(finalization, /run\.beginSettlement\?\./u);
  assert.match(finalization, /settlement\.accepted === false/u);
  assert.match(finalization, /await run\.toolSession\?\.quiesce\?\./u);
  assert.match(finalization, /await run\.disposeResources\?\./u);
  assert.match(finalization, /completeSettlement/u);

  const calls = execution.match(/await this\.finalizeRun\(/gu) ?? [];
  assert.ok(calls.length >= 7);
  assert.doesNotMatch(execution, /(?<!await )this\.finalizeRun\(/u);
});

test("Core Lite 4.6 waits for the active run before global persistence flush", () => {
  const main = read("electron/main.js");
  const runtime = read("electron/agent/AgentRuntime.js");

  assert.match(main, /await agentRuntime\.shutdown\(/u);
  assert.match(
    main,
    /await agentRuntime\.shutdown[\s\S]*await Promise\.all\(\[\s*flushAllPersistenceQueues\(\{/u
  );
  assert.match(runtime, /shutdown\(\{/u);
  assert.match(runtime, /run\.waitForSettlement\(\)/u);
  assert.match(runtime, /run\.abortController\.abort\(reason\)/u);
  assert.match(runtime, /this\.statusBroadcaster\.close/u);
});

test("Core Lite 4.6 prevents new work while shutdown is active", () => {
  const preparation = read("electron/agent/preparation/AgentRunPreparation.js");
  const guards = preparation.match(/code: "runtime-shutting-down"/gu) ?? [];
  const settlingGuards = preparation.match(/"run-settling"/gu) ?? [];
  assert.equal(guards.length, 2);
  assert.equal(settlingGuards.length, 2);
});

test("Core Lite 4.6 contains renderer close races at both status surfaces", () => {
  const runtime = read("electron/agent/AgentRuntime.js");
  const response = read("electron/windows/response/ResponseWindowController.js");

  assert.match(runtime, /function safeWebContentsSend/u);
  assert.match(runtime, /webContents\.isDestroyed\?\.\(\)/u);
  assert.match(runtime, /webContents\.once\?\.\("destroyed", cleanup\)/u);
  assert.match(runtime, /clearStatusWebContents\(\)/u);
  assert.match(response, /sendNow\(channel, args\)/u);
  assert.match(response, /this\.window\.webContents\.isDestroyed\(\)/u);
  assert.match(response, /this\.pendingMessages\.push\(\.\.\.messages\.slice\(index\)\)/u);
});


test("Core Lite 4.6 gives each Tool Session one abortable cleanup scope", () => {
  const session = read("electron/tools/createAgentToolSession.js");

  assert.match(session, /const sessionAbortController = new AbortController\(\)/u);
  assert.match(session, /abortSignal: sessionAbortController\.signal/u);
  assert.match(session, /const quiesce = \(reason = "session-close"\)/u);
  assert.match(session, /await subprocessSupervisor\.terminateAll\(reason\)/u);
  assert.match(session, /return waitForToolSchedulerIdle\(executor\.scheduler\)/u);
  assert.match(session, /if \(closePromise\)/u);
});
