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

test("SubprocessSupervisor isolates output listener failures and reports truncation", async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...values) => warnings.push(values);

  try {
    const supervisor = new SubprocessSupervisor({ maxOutputBytes: 1_024 });
    const result = await supervisor.run(
      process.execPath,
      ["-e", "process.stdout.write('x'.repeat(5000))"],
      {
        onStdout() {
          throw new Error("renderer disconnected");
        }
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.stdoutTruncated, true);
    assert.equal(result.stdoutBytes, 5_000);
    assert.match(result.stdout, /output truncated/u);
    assert.equal(warnings.length > 0, true);
  } finally {
    console.warn = originalWarn;
  }
});
