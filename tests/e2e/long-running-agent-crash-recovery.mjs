import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { PlatformJobScheduler } from "../../electron/platform/PlatformJobScheduler.js";
import { PlatformKernel } from "../../electron/platform/PlatformKernel.js";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-long-running-crash-"));
const worker = path.resolve("tests/fixtures/long-running-agent-crash-worker.mjs");

try {
  const crashed = spawnSync(process.execPath, [worker, "seed", directory], {
    encoding: "utf8"
  });
  assert.equal(crashed.status, 31, crashed.stderr || crashed.stdout);
  const metadata = JSON.parse(fs.readFileSync(path.join(directory, "metadata.json"), "utf8"));

  const kernel = new PlatformKernel({
    getStorageDirectory: () => path.join(directory, "platform"),
    leaseTtlMs: 60_000
  });
  const scheduler = new PlatformJobScheduler({
    platformKernel: kernel,
    autoStart: false
  });
  let repeatedSideEffects = 0;
  scheduler.register("crash-resume", async ({ job, hasReceipt, recordReceipt }) => {
    assert.equal(job.checkpoint.cursor, "after-external-effect");
    if (!hasReceipt("external:publication-one")) {
      repeatedSideEffects += 1;
      recordReceipt({ key: "external:publication-one" });
    }
    return { ok: true, summary: "resumed without repeating publication" };
  });
  scheduler.register("approval-resume", async ({ approval }) => {
    assert.equal(approval.status, "approved");
    return { ok: true, summary: "approved after restart" };
  });

  const recovery = scheduler.recover();
  assert.deepEqual(recovery.recoveredJobIds, [metadata.crashJobId]);
  const resumed = await scheduler.wait(metadata.crashJobId, { timeoutMs: 2_000 });
  assert.equal(resumed.ok, true);
  assert.equal(repeatedSideEffects, 0);
  const crashJob = kernel.getJob(metadata.crashJobId);
  assert.equal(crashJob.status, "completed");
  assert.equal(crashJob.attempt, 2);
  assert.equal(crashJob.receipts.length, 1);

  const approval = kernel.listApprovals({ status: "pending" })[0];
  assert.equal(approval.id, metadata.approvalId);
  assert.equal(scheduler.resolveApproval(approval.id, "approved").ok, true);
  const approved = await scheduler.wait(metadata.approvalJobId, { timeoutMs: 2_000 });
  assert.equal(approved.ok, true);
  assert.equal(kernel.getJob(metadata.approvalJobId).status, "completed");
  assert.equal(kernel.getSnapshot().activeLeases.length, 0);

  console.log("Long-running Agent crash recovery E2E passed.");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
