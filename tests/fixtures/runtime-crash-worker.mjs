import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import {
  ToolRegistry
} from "../../electron/tools/core/ToolRegistry.js";
import {
  ToolExecutionLedger
} from "../../electron/tools/runtime-state/ToolExecutionLedger.js";

const directory = process.argv[2];
const effectFile = path.join(directory, "remote-effect.txt");
const registry = new ToolRegistry();
registry.register({
  name: "crash_write",
  title: "Crash write",
  inputSchema: z.object({ value: z.string() }),
  outputSchema: z.any(),
  sideEffect: "external",
  idempotency: "none",
  runtimeContract: {
    effect: "remote_write",
    retryMode: "reconcile_before_retry",
    supportsAbort: false
  },
  execute: async () => ({ ok: true })
});

const ledger = new ToolExecutionLedger({
  directory,
  taskId: "crash-task",
  runId: "crash-run",
  workspaceId: "",
  ownerId: "crash-worker"
});
const prepared = await ledger.prepare({
  definition: registry.get("crash_write"),
  input: { value: "applied" },
  callId: "crash-call",
  segmentId: "segment-1"
});
await ledger.markDispatched(prepared.call);
await ledger.flush();
fs.writeFileSync(effectFile, "applied", "utf8");
process.exit(91);
