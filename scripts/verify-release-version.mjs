import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const args = new Map(
  process.argv.slice(2).map((entry) => {
    const [key, ...rest] = entry.replace(/^--/u, "").split("=");
    return [key, rest.join("=") || "true"];
  })
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8")
);
const packageLock = JSON.parse(
  fs.readFileSync(path.join(root, "package-lock.json"), "utf8")
);
const version = String(packageJson.version ?? "").trim();
const tag = String(
  args.get("tag") ??
  process.env.GITHUB_REF_NAME ??
  ""
).trim();
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u;

if (!semver.test(version) || version === "0.0.0") {
  throw new Error(`Invalid release version: ${version || "<empty>"}`);
}

if (packageLock.version !== version || packageLock.packages?.[""]?.version !== version) {
  throw new Error("package.json and package-lock.json versions do not match.");
}

if (tag && tag !== `v${version}`) {
  throw new Error(`Release tag ${tag} does not match package version v${version}.`);
}

if (args.get("allow-dirty") !== "true") {
  try {
    const output = execFileSync(
      "git",
      ["status", "--porcelain"],
      { cwd: root, encoding: "utf8" }
    ).trim();
    if (output) {
      throw new Error("Working tree is not clean.");
    }
  } catch (error) {
    if (error?.message === "Working tree is not clean.") {
      throw error;
    }
    throw new Error(
      `Unable to verify a clean git working tree: ${error?.message ?? error}`
    );
  }
}

console.log(`Release version verified: v${version}.`);
