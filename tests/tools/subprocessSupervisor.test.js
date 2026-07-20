import assert from "node:assert/strict";
import test from "node:test";

import {
  SubprocessSupervisor
} from "../../electron/tools/process/SubprocessSupervisor.js";

test("SubprocessSupervisor terminates a process tree after abort", async () => {
  const supervisor = new SubprocessSupervisor({
    defaultTimeoutMs: 5_000,
    terminationGraceMs: 100
  });
  const controller = new AbortController();
  const execution = supervisor.run(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { abortSignal: controller.signal }
  );

  setTimeout(() => controller.abort("test-stop"), 100).unref?.();
  const result = await execution;

  assert.equal(result.terminated, true);
  assert.equal(result.terminationReason, "abort");
  assert.equal(supervisor.snapshot().running.length, 0);
});

test("SubprocessSupervisor returns bounded output and successful exit metadata", async () => {
  const supervisor = new SubprocessSupervisor({ maxOutputBytes: 1024 });
  const result = await supervisor.run(
    process.execPath,
    ["-e", "process.stdout.write('done')"]
  );

  assert.equal(result.ok, true);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "done");
});
