import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2)
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length);
  return String(value ?? fallback).trim();
}

function listJsonFiles(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(absolutePath);
    }
  };
  visit(root);
  return files.sort();
}

function sha256File(filePath) {
  return crypto.createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

function normalizeReport(filePath, root) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || !value.suite) return null;
  return {
    path: path.relative(root, filePath).split(path.sep).join("/"),
    sha256: sha256File(filePath),
    suite: String(value.suite),
    status: String(value.status ?? "unknown"),
    platform: String(value.platform ?? "unknown"),
    arch: String(value.arch ?? "unknown"),
    nodeVersion: String(value.nodeVersion ?? ""),
    durationMs: Number(value.durationMs ?? 0),
    startedAt: value.startedAt ?? null,
    completedAt: value.completedAt ?? null,
    scenarioCount: Array.isArray(value.scenarios) ? value.scenarios.length : null,
    failedScenarios: Array.isArray(value.scenarios)
      ? value.scenarios.filter((item) => item?.status !== "passed")
        .map((item) => String(item?.name ?? "unknown"))
      : []
  };
}

const root = path.resolve(PROJECT_ROOT, arg("root", "test-results/core-lite-4.8"));
const output = path.resolve(
  PROJECT_ROOT,
  arg("output", "test-results/core-lite-4.8/release-candidate-summary.json")
);
const requiredPlatforms = [...new Set(
  arg("require-platforms", process.platform)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
)];
const requiredSuites = [
  "core-lite-lifecycle-soak",
  "core-lite-4.8-electron-release-candidate"
];
const reports = listJsonFiles(root)
  .filter((filePath) => path.resolve(filePath) !== output)
  .map((filePath) => normalizeReport(filePath, root))
  .filter(Boolean);
const errors = [];

for (const platform of requiredPlatforms) {
  for (const suite of requiredSuites) {
    const matches = reports.filter(
      (report) => report.platform === platform && report.suite === suite
    );
    if (matches.length === 0) {
      errors.push(`missing ${suite} report for ${platform}`);
      continue;
    }
    if (!matches.some((report) => report.status === "passed")) {
      errors.push(`${suite} did not pass for ${platform}`);
    }
  }
}

for (const report of reports) {
  if (requiredSuites.includes(report.suite) && report.status !== "passed") {
    errors.push(`failed report: ${report.path}`);
  }
  if (report.failedScenarios.length > 0) {
    errors.push(`failed scenarios in ${report.path}: ${report.failedScenarios.join(", ")}`);
  }
}

const lockPath = path.join(PROJECT_ROOT, "package-lock.json");
const summary = {
  schemaVersion: 1,
  release: "core-lite-4.8",
  status: errors.length === 0 ? "passed" : "failed",
  generatedAt: new Date().toISOString(),
  requiredPlatforms,
  requiredSuites,
  packageLockSha256: fs.existsSync(lockPath) ? sha256File(lockPath) : null,
  reportCount: reports.length,
  reports,
  errors
};

atomicWriteJson(output, summary);
console.log(JSON.stringify(summary, null, 2));
if (errors.length > 0) process.exitCode = 1;
