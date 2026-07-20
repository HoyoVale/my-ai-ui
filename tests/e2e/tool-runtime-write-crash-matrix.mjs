import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAgentToolSession } from "../../electron/tools/createAgentToolSession.js";
import { ToolLeaseStore } from "../../electron/tools/runtime-state/ToolLeaseStore.js";

const worker = fileURLToPath(
  new URL("../fixtures/runtime-write-crash-worker.mjs", import.meta.url)
);
const boundaries = [
  "after_prepare",
  "after_dispatch",
  "write:before_temp_write",
  "write:after_temp_fsync",
  "write:after_atomic_rename",
  "write:after_hash_verify",
  "after_effect",
  "after_receipt",
  "after_report"
];

function spawnWorker(root, runtimeRoot, boundary) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [worker, root, runtimeRoot, boundary],
      { stdio: "inherit" }
    );
    child.once("error", reject);
    child.once("exit", resolve);
  });
}

function createSession(root, runtimeRoot, boundary) {
  return createAgentToolSession({
    taskId: `task-${boundary}`,
    runId: `restart-${boundary}`,
    workspaceId: `workspace-${boundary}`,
    segmentId: "segment-2",
    resultStoreDirectory: runtimeRoot,
    settings: {
      tools: {
        mode: "coding",
        runtime: {},
        workspace: {
          roots: [root],
          maxWriteFileBytes: 1_000_000
        },
        developer: {
          toolsetOverrides: {},
          toolOverrides: {}
        }
      }
    }
  });
}

for (const boundary of boundaries) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), `my-ai-ui-write-crash-${boundary.replace(/[^a-z]/gu, "-")}-`)
  );
  const runtimeRoot = path.join(root, ".runtime-store");
  const target = path.join(root, "effect.txt");
  try {
    const exitCode = await spawnWorker(root, runtimeRoot, boundary);
    assert.equal(exitCode, 87, `worker did not crash at ${boundary}`);
    assert.equal(
      fs.readFileSync(path.join(root, "crash-boundary.txt"), "utf8"),
      boundary
    );

    const effectExistedAtCrash = fs.existsSync(target);
    const mtimeAtCrash = effectExistedAtCrash
      ? fs.statSync(target).mtimeMs
      : 0;
    const leaseStore = new ToolLeaseStore({
      directory: path.join(runtimeRoot, "runtime"),
      ownerId: `recovery-${boundary}`
    });
    await leaseStore.clearOrphaned({ force: true });

    const session = createSession(root, runtimeRoot, boundary);
    const beforeRecovery = session.getRuntimeDiagnostics();

    if (["after_receipt", "after_report"].includes(boundary)) {
      assert.equal(beforeRecovery.receiptCount, 1);
    } else {
      assert.equal(beforeRecovery.receiptCount, 0);
    }

    await new Promise((resolve) => setTimeout(resolve, 15));
    const result = await session.tools.write_text_file.execute(
      {
        path: "effect.txt",
        content: `value-${boundary}\n`,
        createDirectories: false
      },
      { toolCallId: `call-${boundary}` }
    );
    assert.equal(result.ok, true, boundary);
    assert.equal(
      fs.readFileSync(target, "utf8"),
      `value-${boundary}\n`
    );

    if (effectExistedAtCrash) {
      assert.equal(
        fs.statSync(target).mtimeMs,
        mtimeAtCrash,
        `recovery rewrote an already applied file at ${boundary}`
      );
    }

    const afterRecovery = session.getRuntimeDiagnostics();
    assert.equal(afterRecovery.unresolvedCount, 0);
    assert.equal(afterRecovery.receiptCount, 1);
    assert.equal(
      fs.readdirSync(root).some((name) => name.endsWith(".tmp")),
      false,
      `temporary file remained after recovery at ${boundary}: ${fs.readdirSync(root).join(", ")}`
    );
    await session.closePersistence();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log("Tool Runtime atomic-write crash matrix passed.");
