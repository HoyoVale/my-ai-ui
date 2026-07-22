import crypto from "node:crypto";

import {
  createTextDiffPreview
} from "../tools/workspace/textDiffPreview.js";

const MAX_TEXT_CHARS = 1_500_000;
const MAX_DIFF_CHARS = 160_000;

function text(value) {
  return String(value ?? "");
}

function normalizePath(value) {
  return text(value)
    .replace(/\\/gu, "/")
    .replace(/^\.\//u, "")
    .replace(/\/{2,}/gu, "/")
    .replace(/\/$/u, "");
}

function sha256(value) {
  return crypto.createHash("sha256").update(text(value)).digest("hex");
}

function lineStats(diff = "") {
  let added = 0;
  let removed = 0;
  for (const line of text(diff).replace(/\r\n|\r/gu, "\n").split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { added, removed };
}

function boundedText(value) {
  const source = text(value);
  return source.length <= MAX_TEXT_CHARS
    ? { text: source, truncated: false }
    : { text: source.slice(0, MAX_TEXT_CHARS), truncated: true };
}

function snapshotText(value, metadata = {}) {
  if (metadata.exists === false) {
    return {
      exists: false,
      binary: false,
      text: "",
      bytes: 0,
      sha256: ""
    };
  }
  if (metadata.binary === true) {
    return {
      exists: true,
      binary: true,
      text: "",
      bytes: Math.max(0, Number(metadata.bytes) || 0),
      sha256: text(metadata.sha256)
    };
  }
  const bounded = boundedText(value);
  return {
    exists: true,
    binary: false,
    text: bounded.text,
    bytes: Math.max(0, Number(metadata.bytes) || Buffer.byteLength(text(value))),
    sha256: text(metadata.sha256) || sha256(value),
    truncated: bounded.truncated
  };
}

function mutationStatus(entry) {
  if (entry.oldPath && entry.oldPath !== entry.path) return "renamed";
  if (!entry.before.exists && entry.after.exists) return entry.after.binary ? "binary_added" : "added";
  if (entry.before.exists && !entry.after.exists) return entry.before.binary ? "binary_deleted" : "deleted";
  if (entry.before.binary || entry.after.binary) return "binary_modified";
  return "modified";
}

function publicFile(entry) {
  const status = mutationStatus(entry);
  let diff = "";
  let truncated = entry.before.truncated === true || entry.after.truncated === true;
  if (!entry.before.binary && !entry.after.binary && status !== "renamed") {
    const preview = createTextDiffPreview({
      path: entry.path,
      before: entry.before.exists ? entry.before.text : "",
      after: entry.after.exists ? entry.after.text : "",
      maxChars: MAX_DIFF_CHARS
    });
    diff = preview.diff;
    truncated ||= preview.truncated === true;
  } else if (!entry.before.binary && !entry.after.binary && status === "renamed" && entry.before.text !== entry.after.text) {
    const preview = createTextDiffPreview({
      path: entry.path,
      before: entry.before.text,
      after: entry.after.text,
      maxChars: MAX_DIFF_CHARS
    });
    diff = preview.diff;
    truncated ||= preview.truncated === true;
  }
  const stats = lineStats(diff);
  return {
    path: entry.path,
    oldPath: entry.oldPath || "",
    status,
    binary: entry.before.binary || entry.after.binary,
    beforeSha256: entry.before.sha256,
    afterSha256: entry.after.sha256,
    beforeBytes: entry.before.bytes,
    afterBytes: entry.after.bytes,
    added: stats.added,
    removed: stats.removed,
    diff,
    truncated
  };
}

export class RunDiffTracker {
  constructor({ runId = "", workspaceId = "" } = {}) {
    this.runId = text(runId);
    this.workspaceId = text(workspaceId);
    this.entries = new Map();
    this.revision = 0;
  }

  record(mutation = {}) {
    if (!mutation || mutation.dryRun === true || mutation.changed === false) return this.snapshot();
    const kind = text(mutation.kind || "modify");
    const path = normalizePath(mutation.path || mutation.newPath || mutation.destination);
    const oldPath = normalizePath(mutation.oldPath || mutation.source);
    if (!path && kind !== "delete") return this.snapshot();

    if (kind === "rename") {
      const sourceKey = oldPath;
      const existing = this.entries.get(sourceKey);
      const before = existing?.before ?? snapshotText(mutation.beforeText, {
        exists: true,
        binary: mutation.binary,
        bytes: mutation.beforeBytes,
        sha256: mutation.beforeSha256
      });
      this.entries.delete(sourceKey);
      this.entries.set(path, {
        path,
        oldPath: existing?.oldPath || oldPath,
        before,
        after: snapshotText(mutation.afterText ?? mutation.beforeText, {
          exists: true,
          binary: mutation.binary,
          bytes: mutation.afterBytes ?? mutation.beforeBytes,
          sha256: mutation.afterSha256 ?? mutation.beforeSha256
        })
      });
      this.revision += 1;
      return this.snapshot();
    }

    const key = path || oldPath;
    const previous = this.entries.get(key);
    const before = previous?.before ?? snapshotText(mutation.beforeText, {
      exists: mutation.beforeExists !== false && kind !== "add",
      binary: mutation.beforeBinary ?? mutation.binary,
      bytes: mutation.beforeBytes,
      sha256: mutation.beforeSha256
    });
    const after = kind === "delete"
      ? snapshotText("", { exists: false })
      : snapshotText(mutation.afterText, {
          exists: true,
          binary: mutation.afterBinary ?? mutation.binary,
          bytes: mutation.afterBytes,
          sha256: mutation.afterSha256
        });
    this.entries.set(key, {
      path: key,
      oldPath: previous?.oldPath || "",
      before,
      after
    });
    this.revision += 1;
    return this.snapshot();
  }

  snapshot() {
    const files = [...this.entries.values()]
      .map(publicFile)
      .filter((item) => item.beforeSha256 !== item.afterSha256 || item.status === "renamed")
      .sort((left, right) => left.path.localeCompare(right.path));
    const totals = files.reduce((summary, file) => ({
      files: summary.files + 1,
      added: summary.added + file.added,
      removed: summary.removed + file.removed,
      addedFiles: summary.addedFiles + (file.status.includes("added") ? 1 : 0),
      deletedFiles: summary.deletedFiles + (file.status.includes("deleted") ? 1 : 0),
      renamedFiles: summary.renamedFiles + (file.status === "renamed" ? 1 : 0),
      binaryFiles: summary.binaryFiles + (file.binary ? 1 : 0)
    }), {
      files: 0,
      added: 0,
      removed: 0,
      addedFiles: 0,
      deletedFiles: 0,
      renamedFiles: 0,
      binaryFiles: 0
    });
    return {
      version: 1,
      runId: this.runId,
      workspaceId: this.workspaceId,
      revision: this.revision,
      files,
      totals,
      empty: files.length === 0
    };
  }
}
