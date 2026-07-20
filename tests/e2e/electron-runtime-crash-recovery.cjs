const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const electronPath = require("electron");
const fixture = path.resolve(
  __dirname,
  "../fixtures/electron-runtime-crash-main.cjs"
);

function launch(stage, workspaceRoot, runtimeRoot, resultFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      electronPath,
      [
        ...(process.platform === "linux" ? ["--no-sandbox"] : []),
        fixture,
        stage,
        workspaceRoot,
        runtimeRoot,
        resultFile
      ],
      {
        cwd: path.resolve(__dirname, "../.."),
        env: {
          ...process.env,
          ELECTRON_DISABLE_SECURITY_WARNINGS: "true"
        },
        stdio: "inherit",
        windowsHide: true
      }
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

(async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "my-ai-ui-electron-runtime-crash-")
  );
  const workspaceRoot = path.join(root, "workspace");
  const runtimeRoot = path.join(root, "runtime-store");
  const resultFile = path.join(root, "result.json");

  try {
    const crashed = await launch(
      "crash",
      workspaceRoot,
      runtimeRoot,
      resultFile
    );
    assert.equal(crashed.code, 88, "Electron did not exit at crash boundary");
    assert.equal(
      fs.readFileSync(path.join(workspaceRoot, "electron-effect.txt"), "utf8"),
      "electron-crash-recovery\n"
    );

    const recovered = await launch(
      "recover",
      workspaceRoot,
      runtimeRoot,
      resultFile
    );
    assert.equal(recovered.code, 0, "Electron recovery process failed");

    const result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
    assert.equal(result.ok, true);
    assert.equal(result.noRewrite, true);
    assert.equal(result.finalContent, "electron-crash-recovery\n");
    assert.equal(result.unresolvedCount, 0);
    assert.equal(result.receiptCount, 1);
    assert.ok(result.clearedLeases >= 1);
    console.log("Electron process crash recovery E2E passed.");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error("Electron process crash recovery E2E failed:", error);
  process.exitCode = 1;
});
