import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const packagePath = path.join(root, "package.json");
const original = fs.readFileSync(packagePath, "utf8");
const source = JSON.parse(original);
const updaterVersion = String(
  source.releaseTooling?.electronUpdater ?? ""
).trim();

if (!updaterVersion) {
  throw new Error("electron-updater release version is missing.");
}

if (!fs.existsSync(path.join(root, "dist", "index.html"))) {
  throw new Error("dist/index.html is missing. Run npm run build first.");
}

const require = createRequire(import.meta.url);
let builderCli;
try {
  require.resolve("electron-updater");
  builderCli = require.resolve(
    "electron-builder/out/cli/cli.js"
  );
} catch {
  throw new Error(
    "Release dependencies are missing. Run npm run release:bootstrap first."
  );
}


function inferReleasePlatform(arguments_) {
  if (arguments_.includes("--win")) return "win32";
  if (arguments_.includes("--mac")) return "darwin";
  if (arguments_.includes("--linux")) return "linux";
  return process.platform;
}

const releasePackage = {
  ...source,
  dependencies: {
    ...(source.dependencies ?? {}),
    "electron-updater": updaterVersion
  }
};

let restored = false;
function restore() {
  if (restored) return;
  restored = true;
  fs.writeFileSync(packagePath, original, "utf8");
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    restore();
    process.kill(process.pid, signal);
  });
}

try {
  fs.writeFileSync(
    packagePath,
    `${JSON.stringify(releasePackage, null, 2)}\n`,
    "utf8"
  );

  const forwarded = process.argv.slice(2);
  if (
    process.platform === "darwin" &&
    process.env.RELEASE_REQUIRE_NOTARIZATION === "true"
  ) {
    forwarded.push(
      "-c.mac.notarize=true"
    );
  }

  const args = [
    builderCli,
    "--config",
    "electron-builder.yml",
    ...forwarded
  ];
  const releasePlatform =
    process.env.RELEASE_PLATFORM ??
    inferReleasePlatform(forwarded);
  const builderEnvironment = {
    ...process.env,
    RELEASE_PLATFORM: releasePlatform,
    GH_REPO_OWNER:
      process.env.GH_REPO_OWNER ?? "local",
    GH_REPO_NAME:
      process.env.GH_REPO_NAME ?? source.name
  };
  const result = spawnSync(
    process.execPath,
    args,
    {
      cwd: root,
      stdio: "inherit",
      env: builderEnvironment
    }
  );

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
} finally {
  restore();
}
