import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "my-ai-ui-goal-runtime-")
);
const worker = path.resolve(
  "tests/fixtures/goal-runtime-crash-worker.mjs"
);

try {
  const crashed = spawnSync(
    process.execPath,
    [worker, "seed", directory],
    { encoding: "utf8" }
  );
  assert.equal(crashed.status, 17, crashed.stderr || crashed.stdout);

  const recovered = spawnSync(
    process.execPath,
    [worker, "recover", directory],
    { encoding: "utf8" }
  );
  assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);

  const goal = JSON.parse(recovered.stdout);
  assert.equal(goal.version, 6);
  assert.equal(goal.phase, "waiting");
  assert.equal(goal.waiting.kind, "recovery");
  assert.equal(goal.waiting.requiredAction, "resume_from_checkpoint");
  assert.equal(goal.runtime.activeRunId, null);
  assert.equal(goal.runtime.lastRunId, "run-before-crash");
  assert.equal(goal.checkpoint.id, "checkpoint-before-crash");
  assert.equal(goal.checkpoint.messageId, "message-before-crash");
  assert.equal(goal.eventHistory.at(-1).type, "goal_recovered");

  console.log("Goal Runtime crash recovery E2E passed.");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
