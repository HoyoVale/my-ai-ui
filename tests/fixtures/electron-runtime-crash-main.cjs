const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app } = require("electron");

function readArgument(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) =>
    String(argument).startsWith(prefix)
  );
  return value ? value.slice(prefix.length) : "";
}

function requireArgument(name) {
  const value = readArgument(name);
  if (!value) {
    throw new Error(`Missing Electron crash fixture argument: ${name}`);
  }
  return value;
}

const stage = requireArgument("stage");
const workspaceRoot = requireArgument("workspace-root");
const runtimeRoot = requireArgument("runtime-root");
const resultFile = requireArgument("result-file");
const boundary = "write:after_atomic_rename";
const callId = "electron-atomic-write-call";
const taskId = "electron-runtime-crash-task";
const workspaceId = "electron-runtime-crash-workspace";
const targetPath = path.join(workspaceRoot, "electron-effect.txt");
const markerPath = path.join(workspaceRoot, "electron-crash-marker.json");

function moduleUrl(relativePath) {
  return pathToFileURL(path.resolve(__dirname, "../..", relativePath)).href;
}

function settings() {
  return {
    tools: {
      mode: "coding",
      runtime: {
        journalMaxFileBytes: 256000,
        journalMaxArchives: 4,
        journalMaxTotalBytes: 2000000
      },
      workspace: {
        roots: [workspaceRoot],
        maxWriteFileBytes: 1000000
      },
      developer: {
        toolsetOverrides: {},
        toolOverrides: {}
      }
    }
  };
}

async function createSession(runId, faultInjector = null) {
  const { createAgentToolSession } = await import(
    moduleUrl("electron/tools/createAgentToolSession.js")
  );
  return createAgentToolSession({
    taskId,
    runId,
    workspaceId,
    segmentId: stage === "crash" ? "segment-crash" : "segment-recovery",
    resultStoreDirectory: runtimeRoot,
    faultInjector,
    settings: settings()
  });
}

async function main() {
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(runtimeRoot, { recursive: true });

  if (stage === "crash") {
    const session = await createSession(
      "electron-run-crash",
      async (currentBoundary) => {
        if (currentBoundary !== boundary) {
          return;
        }
        const stat = fs.statSync(targetPath);
        fs.writeFileSync(markerPath, JSON.stringify({
          boundary,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          content: fs.readFileSync(targetPath, "utf8"),
          crashedAt: Date.now()
        }, null, 2));
        process.exit(88);
      }
    );
    await session.tools.write_text_file.execute(
      {
        path: "electron-effect.txt",
        content: "electron-crash-recovery\n",
        createDirectories: false
      },
      { toolCallId: callId }
    );
    await session.closePersistence();
    throw new Error("Crash boundary was not reached.");
  }

  if (stage !== "recover") {
    throw new Error(`Unknown stage: ${stage}`);
  }

  const { ToolLeaseStore } = await import(
    moduleUrl("electron/tools/runtime-state/ToolLeaseStore.js")
  );
  const leaseStore = new ToolLeaseStore({
    directory: path.join(runtimeRoot, "runtime"),
    ownerId: "electron-recovery-owner"
  });
  const clearedLeases = await leaseStore.clearOrphaned({ force: true });
  const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 25));

  const session = await createSession("electron-run-recovery");
  const before = session.getRuntimeDiagnostics();
  const output = await session.tools.write_text_file.execute(
    {
      path: "electron-effect.txt",
      content: "electron-crash-recovery\n",
      createDirectories: false
    },
    { toolCallId: callId }
  );
  const after = session.getRuntimeDiagnostics();
  const stat = fs.statSync(targetPath);
  const result = {
    ok: output?.ok === true,
    output,
    clearedLeases,
    before,
    after,
    marker,
    finalMtimeMs: stat.mtimeMs,
    finalContent: fs.readFileSync(targetPath, "utf8"),
    noRewrite: stat.mtimeMs === marker.mtimeMs,
    unresolvedCount: after.unresolvedCount,
    receiptCount: after.receiptCount
  };
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2), "utf8");
  await session.closePersistence();
  app.exit(result.ok && result.noRewrite ? 0 : 1);
}

app.whenReady().then(main).catch((error) => {
  console.error("Electron runtime crash fixture failed:", error);
  try {
    fs.writeFileSync(resultFile, JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.stack : String(error)
    }, null, 2));
  } catch {
    // Preserve the original failure.
  }
  app.exit(1);
});
