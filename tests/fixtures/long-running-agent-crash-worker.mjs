import fs from "node:fs";
import path from "node:path";

import { PlatformKernel } from "../../electron/platform/PlatformKernel.js";

const [mode, directory] = process.argv.slice(2);
const storage = path.join(directory, "platform");
const metadataPath = path.join(directory, "metadata.json");
const kernel = new PlatformKernel({
  getStorageDirectory: () => storage,
  leaseTtlMs: 60_000
});

if (mode === "seed") {
  const run = kernel.ensureRun({
    conversationId: "long-running-crash-conversation",
    goalId: "long-running-crash-goal",
    objective: "recover long-running jobs without duplicate effects",
    mode: "coding"
  }).run;
  const crashJob = kernel.enqueueJob(run.id, {
    type: "crash-resume",
    title: "Resume from durable checkpoint",
    maxAttempts: 3,
    idempotencyKey: "crash-resume-one"
  }).job;
  kernel.setJobStatus(crashJob.id, "running", { reason: "seed-crash-window" });
  kernel.recordJobCheckpoint(crashJob.id, {
    cursor: "after-external-effect",
    summary: "external publication receipt was committed"
  });
  kernel.recordJobReceipt(crashJob.id, {
    key: "external:publication-one",
    summary: "publication already happened"
  });

  const approvalJob = kernel.enqueueJob(run.id, {
    type: "approval-resume",
    title: "Approval survives restart",
    payload: { approvalRequired: true },
    idempotencyKey: "approval-resume-one"
  }).job;
  const approval = kernel.requestJobApproval(approvalJob.id, {
    action: "publish",
    risk: "high",
    summary: "Approve after restarting the application."
  }).approval;
  fs.writeFileSync(metadataPath, JSON.stringify({
    runId: run.id,
    crashJobId: crashJob.id,
    approvalJobId: approvalJob.id,
    approvalId: approval.id
  }));
  process.exit(31);
}

if (mode === "inspect") {
  process.stdout.write(JSON.stringify({
    metadata: JSON.parse(fs.readFileSync(metadataPath, "utf8")),
    snapshot: kernel.getSnapshot()
  }));
  process.exit(0);
}

throw new Error(`Unknown mode: ${mode}`);
