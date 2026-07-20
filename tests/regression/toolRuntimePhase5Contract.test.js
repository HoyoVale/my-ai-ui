import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

function source(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("phase 5 keeps production subprocess creation behind the supervisor", () => {
  const electronRoot = path.join(projectRoot, "electron");
  const offenders = [];

  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(target);
      } else if (/\.(?:js|cjs|mjs)$/u.test(entry.name)) {
        const text = fs.readFileSync(target, "utf8");
        if (
          text.includes("node:child_process") &&
          !target.endsWith(path.join("tools", "process", "SubprocessSupervisor.js"))
        ) {
          offenders.push(path.relative(projectRoot, target));
        }
      }
    }
  }

  walk(electronRoot);
  assert.deepEqual(offenders, []);
  assert.match(
    source("electron/tools/workspace/workspaceProcessTools.js"),
    /subprocessSupervisor\.run/u
  );
});

test("phase 5 atomic writes expose verification and crash boundaries", () => {
  const writer = source("electron/tools/workspace/atomicFileWriter.js");
  const tool = source("electron/tools/workspace/workspaceWriteTools.js");
  const executor = source("electron/tools/core/ToolExecutor.js");

  assert.match(writer, /handle\.sync\(\)/u);
  assert.match(writer, /after_atomic_rename/u);
  assert.match(writer, /after_hash_verify/u);
  assert.match(tool, /retryMode:\s*"idempotency_key"/u);
  assert.match(tool, /async verify/u);
  assert.match(tool, /async reconcile/u);
  assert.match(executor, /after_receipt/u);
  assert.match(executor, /after_report/u);
});

test("phase 5 CI runs crash recovery, benchmarks, and a scheduled soak", () => {
  const ci = source(".github/workflows/ci.yml");
  const soak = source(".github/workflows/runtime-soak.yml");

  assert.match(ci, /test:e2e:runtime-write-crash/u);
  assert.match(ci, /test:e2e:electron-runtime-crash/u);
  assert.match(ci, /test:benchmark/u);
  assert.match(soak, /test:soak/u);
  assert.match(soak, /schedule:/u);
});
