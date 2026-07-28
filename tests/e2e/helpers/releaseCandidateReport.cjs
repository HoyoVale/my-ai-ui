const fs = require("node:fs");
const path = require("node:path");

function serializeError(error) {
  if (!error) return null;
  return {
    name: String(error.name ?? "Error"),
    message: String(error.message ?? error),
    code: error.code == null ? null : String(error.code),
    stack: String(error.stack ?? "").slice(0, 20_000)
  };
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, filePath);
}

function createReleaseCandidateReport({ suite, outputPath }) {
  const report = {
    schemaVersion: 1,
    suite,
    status: "running",
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    startedAt: new Date().toISOString(),
    completedAt: null,
    durationMs: null,
    scenarios: [],
    metrics: {},
    diagnostics: {
      logs: [],
      mainIssues: [],
      rendererIssues: []
    },
    error: null
  };
  const startedAt = Date.now();

  async function scenario(name, callback) {
    const entry = {
      name,
      status: "running",
      startedAt: new Date().toISOString(),
      completedAt: null,
      durationMs: null,
      details: null,
      error: null
    };
    report.scenarios.push(entry);
    const start = Date.now();
    try {
      entry.details = await callback();
      entry.status = "passed";
      return entry.details;
    } catch (error) {
      entry.status = "failed";
      entry.error = serializeError(error);
      throw error;
    } finally {
      entry.completedAt = new Date().toISOString();
      entry.durationMs = Date.now() - start;
      atomicWriteJson(outputPath, report);
    }
  }

  function finish(error = null) {
    report.status = error ? "failed" : "passed";
    report.error = serializeError(error);
    report.completedAt = new Date().toISOString();
    report.durationMs = Date.now() - startedAt;
    atomicWriteJson(outputPath, report);
    return report;
  }

  atomicWriteJson(outputPath, report);
  return { report, scenario, finish };
}

module.exports = {
  atomicWriteJson,
  createReleaseCandidateReport,
  serializeError
};
