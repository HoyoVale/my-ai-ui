import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import {
  atomicWriteFileBuffer,
  atomicWriteFileTransaction,
  sha256Buffer,
  sha256File
} from "./atomicFileWriter.js";
import {
  decodeTextBuffer,
  encodeTextBuffer,
  newlineSequence,
  normalizeTextNewlines,
  resolveWriteCodec
} from "./textFileCodec.js";
import {
  applyUnifiedFilePatch,
  parseUnifiedPatch
} from "./unifiedPatch.js";
import {
  fileEvidence,
  receiptFields,
  transactionEvidence
} from "./writeEvidence.js";
import {
  resolveWorkspaceMutationPath,
  resolveWorkspaceWritePath
} from "./workspacePolicy.js";

const HASH_PATTERN = /^[a-fA-F0-9]{64}$/u;
const hashSchema = z.union([z.literal(""), z.string().regex(HASH_PATTERN)]).default("");
const pathSchema = z.string().trim().min(1).max(500);
const encodingSchema = z.enum(["auto", "utf8", "utf16le"]).default("auto");

function writeError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function normalizeHash(value) {
  return String(value ?? "").trim().toLowerCase();
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error("文件操作已取消。");
  error.name = "AbortError";
  error.code = "CANCELLED_BY_USER";
  throw error;
}


function lineSummary(before, after) {
  const left = String(before ?? "").replace(/\r\n|\r/gu, "\n").split("\n");
  const right = String(after ?? "").replace(/\r\n|\r/gu, "\n").split("\n");
  if (left.at(-1) === "") left.pop();
  if (right.at(-1) === "") right.pop();
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) suffix += 1;
  return {
    addedLines: Math.max(0, right.length - prefix - suffix),
    removedLines: Math.max(0, left.length - prefix - suffix)
  };
}

function countOccurrences(text, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while (true) {
    const found = text.indexOf(needle, index);
    if (found < 0) return count;
    count += 1;
    index = found + needle.length;
  }
}

function replaceOccurrences(text, oldText, newText) {
  return text.split(oldText).join(newText);
}

async function inspectFile(resolved, maxBytes, { required = false } = {}) {
  const stat = await fs.promises.lstat(resolved.path).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) {
    if (required) throw writeError("PATH_NOT_FOUND", "目标文件不存在。");
    return null;
  }
  if (stat.isSymbolicLink()) throw writeError("SYMLINK_WRITE_BLOCKED", "拒绝修改符号链接。");
  if (!stat.isFile()) throw writeError("FILE_REQUIRED", "目标路径不是普通文件。");
  if (stat.size > maxBytes) throw writeError("FILE_TOO_LARGE", "目标文件超过写工具大小上限。");
  const buffer = await fs.promises.readFile(resolved.path);
  return {
    ...decodeTextBuffer(buffer, { encoding: "auto" }),
    buffer,
    sha256: sha256Buffer(buffer),
    mode: stat.mode & 0o777,
    sizeBytes: buffer.length
  };
}

function assertExpectedHash(expectedSha256, actualSha256) {
  const expected = normalizeHash(expectedSha256);
  if (expected && expected !== normalizeHash(actualSha256)) {
    throw writeError("FILE_VERSION_CONFLICT", "目标文件已发生变化，拒绝修改。", {
      expectedSha256: expected,
      actualSha256: normalizeHash(actualSha256)
    });
  }
}

function assertWriteIntent(input, exists) {
  if (input.createOnly && exists) {
    throw writeError("FILE_EXISTS", "目标文件已存在，createOnly 写入被拒绝。");
  }
  if (input.overwrite === false && exists) {
    throw writeError("FILE_EXISTS", "目标文件已存在，overwrite=false 时拒绝覆盖。");
  }
}

function writeConcurrencyKey(input, workspaceSettings, names = ["path"]) {
  const values = [];
  for (const name of names) {
    try {
      const resolved = resolveWorkspaceMutationPath(input?.[name], {
        workspaceSettings,
        allowCreateParents: true,
        mustExist: false,
        allowFile: true,
        allowDirectory: true
      });
      const normalized = path.normalize(resolved.path);
      values.push(process.platform === "win32" ? normalized.toLowerCase() : normalized);
    } catch {
      values.push(path.normalize(String(input?.[name] ?? "")));
    }
  }
  return `workspace-write:${values.sort().join("|")}`;
}

const effectEvidenceSchema = z.object({
  kind: z.string(),
  operation: z.string(),
  affectedPaths: z.array(z.string()),
  bytesChanged: z.number().nonnegative(),
  atomic: z.boolean(),
  dryRun: z.boolean()
}).passthrough();

const receiptSchemaFields = {
  operation: z.string(),
  affectedPaths: z.array(z.string()),
  beforeSha256: z.string(),
  afterSha256: z.string(),
  bytesChanged: z.number().nonnegative(),
  receiptId: z.string(),
  rollbackAvailable: z.boolean(),
  rollbackPerformed: z.boolean(),
  addedLines: z.number().int().nonnegative(),
  removedLines: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
  effectEvidence: effectEvidenceSchema
};

function dryRunVerification(receipt, input) {
  return input?.dryRun === true || receipt?.output?.data?.dryRun === true;
}

function singleFileRuntimeContract({ workspaceSettings, retryMode = "idempotency_key", reconcile = null } = {}) {
  return {
    effect: "local_write",
    retryMode,
    supportsAbort: true,
    supportsResume: retryMode !== "manual_only",
    leaseTtlMs: 60_000,
    heartbeatMs: 5_000,
    async verify({ receipt, input }) {
      if (dryRunVerification(receipt, input)) {
        return { status: "valid", evidence: { kind: "dry_run", dryRun: true } };
      }
      const evidence = receipt?.metadata?.effectEvidence ?? receipt?.output?.data?.effectEvidence;
      const relativePath = evidence?.affectedPaths?.[0] ?? input?.path ?? "";
      const expected = String(evidence?.afterSha256 ?? receipt?.output?.data?.afterSha256 ?? "");
      try {
        const resolved = resolveWorkspaceWritePath(relativePath, { workspaceSettings });
        const current = await sha256File(resolved.path, {
          maxBytes: workspaceSettings.maxWriteFileBytes ?? 5_000_000
        });
        return current.sha256 === expected
          ? { status: "valid", evidence: { ...evidence, actualSha256: current.sha256 } }
          : { status: "not_applied", evidence: { ...evidence, actualSha256: current.sha256 } };
      } catch (error) {
        return {
          status: error?.code === "ENOENT" || error?.code === "PATH_NOT_FOUND" ? "not_applied" : "unknown",
          evidence: { ...evidence, error: error instanceof Error ? error.message : String(error) }
        };
      }
    },
    async reconcile(args) {
      if (args.input?.dryRun === true) {
        return {
          status: "applied",
          output: { ok: true, data: { dryRun: true, reconciled: true } },
          result: { status: "success", summary: "已核验 Dry-run，无文件副作用。", preview: "", truncated: false, clipped: false },
          evidence: { kind: "dry_run", dryRun: true }
        };
      }
      if (typeof reconcile === "function") return reconcile(args);
      return { status: "unknown", evidence: { reason: "manual_reconciliation_required" } };
    }
  };
}

function createDirectoryRuntimeContract(workspaceSettings) {
  return {
    effect: "local_write",
    retryMode: "idempotency_key",
    supportsAbort: true,
    supportsResume: true,
    leaseTtlMs: 60_000,
    heartbeatMs: 5_000,
    async verify({ input }) {
      if (input?.dryRun) return { status: "valid", evidence: { kind: "dry_run", dryRun: true } };
      try {
        const resolved = resolveWorkspaceMutationPath(input.path, {
          workspaceSettings,
          allowCreateParents: true,
          mustExist: true,
          allowFile: false,
          allowDirectory: true
        });
        return { status: "valid", evidence: { kind: "workspace_directory", path: resolved.relativePath } };
      } catch (error) {
        return { status: "not_applied", evidence: { error: error instanceof Error ? error.message : String(error) } };
      }
    },
    async reconcile({ input }) {
      if (input?.dryRun) return { status: "applied", evidence: { kind: "dry_run", dryRun: true } };
      try {
        const resolved = resolveWorkspaceMutationPath(input.path, {
          workspaceSettings,
          allowCreateParents: true,
          mustExist: true,
          allowFile: false,
          allowDirectory: true
        });
        const evidence = { kind: "workspace_directory", operation: "create_directory", affectedPaths: [resolved.relativePath], bytesChanged: 0, atomic: true, dryRun: false };
        return {
          status: "applied",
          output: { ok: true, data: { path: resolved.relativePath, changed: false, created: false, dryRun: false, ...receiptFields(evidence) } },
          result: { status: "success", summary: `已核验目录 ${resolved.relativePath}`, preview: "", truncated: false, clipped: false },
          evidence
        };
      } catch (error) {
        return { status: "not_applied", evidence: { error: error instanceof Error ? error.message : String(error) } };
      }
    }
  };
}

function moveRuntimeContract(workspaceSettings) {
  return {
    effect: "local_write",
    retryMode: "reconcile_before_retry",
    supportsAbort: true,
    supportsResume: true,
    leaseTtlMs: 60_000,
    heartbeatMs: 5_000,
    async verify({ receipt, input }) {
      if (dryRunVerification(receipt, input)) return { status: "valid", evidence: { kind: "dry_run", dryRun: true } };
      const evidence = receipt?.metadata?.effectEvidence ?? receipt?.output?.data?.effectEvidence ?? {};
      try {
        const source = resolveWorkspaceMutationPath(input.source, {
          workspaceSettings,
          allowCreateParents: false,
          mustExist: false,
          allowFile: true,
          allowDirectory: true
        });
        const destination = resolveWorkspaceMutationPath(input.destination, {
          workspaceSettings: { ...workspaceSettings, roots: [source.root] },
          allowCreateParents: true,
          mustExist: false,
          allowFile: true,
          allowDirectory: true
        });
        if (source.exists || !destination.exists) return { status: "not_applied", evidence };
        if (evidence.afterSha256 && destination.type === "file") {
          const current = await sha256File(destination.path, { maxBytes: workspaceSettings.maxWriteFileBytes ?? 5_000_000 });
          if (current.sha256 !== evidence.afterSha256) return { status: "not_applied", evidence: { ...evidence, actualSha256: current.sha256 } };
        }
        return { status: "valid", evidence };
      } catch (error) {
        return { status: "unknown", evidence: { ...evidence, error: error instanceof Error ? error.message : String(error) } };
      }
    },
    async reconcile({ input }) {
      if (input?.dryRun) return { status: "applied", evidence: { kind: "dry_run", dryRun: true } };
      try {
        const source = resolveWorkspaceMutationPath(input.source, {
          workspaceSettings,
          allowCreateParents: false,
          mustExist: false,
          allowFile: true,
          allowDirectory: true
        });
        const destination = resolveWorkspaceMutationPath(input.destination, {
          workspaceSettings: { ...workspaceSettings, roots: [source.root] },
          allowCreateParents: true,
          mustExist: false,
          allowFile: true,
          allowDirectory: true
        });
        return !source.exists && destination.exists
          ? { status: "applied", evidence: { kind: "workspace_move", source: input.source, destination: input.destination } }
          : { status: "not_applied", evidence: { sourceExists: source.exists, destinationExists: destination.exists } };
      } catch (error) {
        return { status: "unknown", evidence: { error: error instanceof Error ? error.message : String(error) } };
      }
    }
  };
}

export function createWorkspaceWriteToolDefinitions(workspaceSettings = {}) {
  const maxWriteFileBytes = Math.min(20_000_000, Math.max(1_024, Number(workspaceSettings.maxWriteFileBytes) || 5_000_000));
  const maxPatchBytes = Math.min(2_000_000, Math.max(16_384, Number(workspaceSettings.maxPatchBytes) || 500_000));
  const maxPatchFiles = Math.min(50, Math.max(1, Number(workspaceSettings.maxPatchFiles) || 20));

  const writeTextInput = z.object({
    path: pathSchema,
    content: z.string().max(maxWriteFileBytes),
    encoding: encodingSchema,
    expectedSha256: hashSchema,
    createDirectories: z.boolean().default(false),
    createOnly: z.boolean().default(false),
    overwrite: z.boolean().default(true),
    preserveNewline: z.boolean().default(true),
    dryRun: z.boolean().default(false)
  });

  const writeTextOutput = z.object({
    ok: z.literal(true),
    data: z.object({
      path: z.string(),
      changed: z.boolean(),
      created: z.boolean(),
      dryRun: z.boolean(),
      beforeSha256: z.string(),
      afterSha256: z.string(),
      beforeBytes: z.number().int().nonnegative(),
      bytes: z.number().int().nonnegative(),
      encoding: z.enum(["utf8", "utf16le"]),
      bom: z.boolean(),
      newline: z.enum(["lf", "crlf", "cr", "mixed", "none"]),
      atomic: z.boolean(),
      idempotentReplay: z.boolean(),
      ...receiptSchemaFields
    })
  });

  const writeRuntime = singleFileRuntimeContract({
    workspaceSettings,
    retryMode: "idempotency_key",
    reconcile: async ({ input }) => {
      try {
        const resolved = resolveWorkspaceWritePath(input.path, {
          workspaceSettings,
          allowCreateDirectories: input.createDirectories
        });
        const existing = await inspectFile(resolved, maxWriteFileBytes);
        const codec = resolveWriteCodec({
          requestedEncoding: input.encoding,
          existing,
          preserveNewline: input.preserveNewline,
          content: input.content
        });
        const desired = encodeTextBuffer(codec.text, codec);
        const actual = existing?.sha256 ?? "";
        const expected = sha256Buffer(desired);
        return actual === expected
          ? { status: "applied", evidence: fileEvidence({ operation: "write_text_file", relativePath: resolved.relativePath, beforeSha256: actual, afterSha256: expected, beforeBytes: existing?.sizeBytes ?? 0, afterBytes: desired.length }) }
          : { status: "not_applied", evidence: { expectedSha256: expected, actualSha256: actual } };
      } catch (error) {
        return { status: "unknown", evidence: { error: error instanceof Error ? error.message : String(error) } };
      }
    }
  });

  return [
    {
      name: "write_text_file",
      version: 2,
      title: "Write text file",
      description: "Atomically create or replace one safe text file. Supports dry-run, UTF-8/UTF-16LE, newline preservation, create-only/overwrite policies, optimistic SHA-256 concurrency, verification, rollback on detected failure, and durable receipts.",
      inputSchema: writeTextInput,
      outputSchema: writeTextOutput,
      sideEffect: "write",
      riskLevel: "medium",
      idempotency: "natural",
      supportsDryRun: true,
      concurrencyKey: (input) => writeConcurrencyKey(input, workspaceSettings),
      runtimeContract: writeRuntime,
      async execute(input, context = {}) {
        throwIfAborted(context.abortSignal);
        const resolved = resolveWorkspaceWritePath(input.path, {
          workspaceSettings,
          allowCreateDirectories: input.createDirectories
        });
        const existing = await inspectFile(resolved, maxWriteFileBytes);
        assertWriteIntent(input, Boolean(existing));
        assertExpectedHash(input.expectedSha256, existing?.sha256 ?? "");
        const codec = resolveWriteCodec({
          requestedEncoding: input.encoding,
          existing,
          preserveNewline: input.preserveNewline,
          content: input.content
        });
        const desired = encodeTextBuffer(codec.text, codec);
        if (desired.length > maxWriteFileBytes) throw writeError("FILE_TOO_LARGE", "写入内容超过工作区写工具上限。");
        const afterSha256 = sha256Buffer(desired);
        const changed = existing?.sha256 !== afterSha256;
        const summary = lineSummary(existing?.text ?? "", codec.text);
        const warnings = [];
        if (existing?.newline === "mixed" && input.preserveNewline) warnings.push("原文件包含混合换行，未强制统一换行。 ".trim());
        const effectEvidence = fileEvidence({
          operation: "write_text_file",
          relativePath: resolved.relativePath,
          beforeSha256: existing?.sha256 ?? "",
          afterSha256,
          beforeBytes: existing?.sizeBytes ?? 0,
          afterBytes: desired.length,
          dryRun: input.dryRun,
          created: !existing
        });
        if (input.dryRun) {
          return {
            ok: true,
            data: {
              path: resolved.relativePath,
              changed,
              created: !existing,
              dryRun: true,
              beforeSha256: existing?.sha256 ?? "",
              afterSha256,
              beforeBytes: existing?.sizeBytes ?? 0,
              bytes: desired.length,
              encoding: codec.encoding,
              bom: codec.bom,
              newline: codec.newline,
              atomic: true,
              idempotentReplay: !changed,
              ...receiptFields(effectEvidence, { warnings, ...summary })
            }
          };
        }
        const write = await atomicWriteFileBuffer({
          targetPath: resolved.path,
          buffer: desired,
          expectedSha256: input.expectedSha256,
          createDirectories: input.createDirectories,
          createOnly: input.createOnly,
          overwrite: input.overwrite,
          idempotencyKey: context.idempotencyKey || context.callId,
          abortSignal: context.abortSignal,
          onBoundary: context.onWriteBoundary
        });
        return {
          ok: true,
          data: {
            path: resolved.relativePath,
            changed: write.changed,
            created: write.created,
            dryRun: false,
            beforeSha256: write.beforeSha256,
            afterSha256: write.afterSha256,
            beforeBytes: write.beforeBytes,
            bytes: write.bytes,
            encoding: codec.encoding,
            bom: codec.bom,
            newline: codec.newline,
            atomic: write.atomic,
            idempotentReplay: write.idempotentReplay,
            ...receiptFields(effectEvidence, { warnings, rollbackPerformed: write.rollbackPerformed, ...summary })
          }
        };
      }
    },
    {
      name: "replace_text_in_file",
      version: 1,
      title: "Replace text in file",
      description: "Precisely replace an expected number of literal text occurrences in one existing text file. Refuses missing or ambiguous matches, preserves encoding and newline style, supports dry-run and SHA-256 concurrency, and writes atomically.",
      inputSchema: z.object({
        path: pathSchema,
        oldText: z.string().min(1).max(maxWriteFileBytes),
        newText: z.string().max(maxWriteFileBytes),
        expectedOccurrences: z.number().int().min(1).max(1000).default(1),
        expectedSha256: hashSchema,
        preserveNewline: z.boolean().default(true),
        dryRun: z.boolean().default(false)
      }),
      outputSchema: z.object({
        ok: z.literal(true),
        data: z.object({
          path: z.string(), changed: z.boolean(), dryRun: z.boolean(), occurrences: z.number().int().positive(),
          beforeSha256: z.string(), afterSha256: z.string(), beforeBytes: z.number().int().nonnegative(), bytes: z.number().int().nonnegative(),
          encoding: z.enum(["utf8", "utf16le"]), bom: z.boolean(), newline: z.enum(["lf", "crlf", "cr", "mixed", "none"]), atomic: z.boolean(),
          ...receiptSchemaFields
        })
      }),
      sideEffect: "write",
      riskLevel: "medium",
      idempotency: "none",
      supportsDryRun: true,
      concurrencyKey: (input) => writeConcurrencyKey(input, workspaceSettings),
      runtimeContract: singleFileRuntimeContract({ workspaceSettings, retryMode: "manual_only" }),
      async execute(input, context = {}) {
        const resolved = resolveWorkspaceMutationPath(input.path, {
          workspaceSettings, mustExist: true, allowFile: true, allowDirectory: false
        });
        const existing = await inspectFile(resolved, maxWriteFileBytes, { required: true });
        assertExpectedHash(input.expectedSha256, existing.sha256);
        const oldText = input.preserveNewline ? normalizeTextNewlines(input.oldText, existing.newline) : input.oldText;
        const newText = input.preserveNewline ? normalizeTextNewlines(input.newText, existing.newline) : input.newText;
        const occurrences = countOccurrences(existing.text, oldText);
        if (occurrences === 0) throw writeError("CONTENT_NOT_FOUND", "未找到要替换的原文本。");
        if (occurrences !== input.expectedOccurrences) {
          throw writeError("CONTENT_OCCURRENCE_MISMATCH", `原文本出现 ${occurrences} 次，与 expectedOccurrences=${input.expectedOccurrences} 不一致。`, { occurrences });
        }
        const nextText = replaceOccurrences(existing.text, oldText, newText);
        const desired = encodeTextBuffer(nextText, existing);
        if (desired.length > maxWriteFileBytes) throw writeError("FILE_TOO_LARGE", "替换后的文件超过写工具上限。");
        const afterSha256 = sha256Buffer(desired);
        const summary = lineSummary(existing.text, nextText);
        const effectEvidence = fileEvidence({ operation: "replace_text_in_file", relativePath: resolved.relativePath, beforeSha256: existing.sha256, afterSha256, beforeBytes: existing.sizeBytes, afterBytes: desired.length, dryRun: input.dryRun });
        if (!input.dryRun) {
          const write = await atomicWriteFileBuffer({
            targetPath: resolved.path, buffer: desired, expectedSha256: input.expectedSha256 || existing.sha256,
            idempotencyKey: context.idempotencyKey || context.callId, abortSignal: context.abortSignal, onBoundary: context.onWriteBoundary
          });
          effectEvidence.rollbackPerformed = write.rollbackPerformed === true;
        }
        return {
          ok: true,
          data: {
            path: resolved.relativePath, changed: afterSha256 !== existing.sha256, dryRun: input.dryRun, occurrences,
            beforeSha256: existing.sha256, afterSha256, beforeBytes: existing.sizeBytes, bytes: desired.length,
            encoding: existing.encoding, bom: existing.bom, newline: existing.newline, atomic: true,
            ...receiptFields(effectEvidence, summary)
          }
        };
      }
    },
    {
      name: "append_text_file",
      version: 1,
      title: "Append text file",
      description: "Append text to one safe file through a full atomic replacement. File creation must be explicitly allowed. Preserves the existing encoding/newline style and supports dry-run and SHA-256 concurrency.",
      inputSchema: z.object({
        path: pathSchema,
        content: z.string().min(1).max(maxWriteFileBytes),
        expectedSha256: hashSchema,
        createIfMissing: z.boolean().default(false),
        createDirectories: z.boolean().default(false),
        ensureNewline: z.boolean().default(true),
        encoding: encodingSchema,
        dryRun: z.boolean().default(false)
      }),
      outputSchema: z.object({
        ok: z.literal(true),
        data: z.object({
          path: z.string(), changed: z.boolean(), created: z.boolean(), dryRun: z.boolean(), appendedBytes: z.number().int().nonnegative(),
          beforeSha256: z.string(), afterSha256: z.string(), beforeBytes: z.number().int().nonnegative(), bytes: z.number().int().nonnegative(),
          encoding: z.enum(["utf8", "utf16le"]), bom: z.boolean(), newline: z.enum(["lf", "crlf", "cr", "mixed", "none"]), atomic: z.boolean(),
          ...receiptSchemaFields
        })
      }),
      sideEffect: "write",
      riskLevel: "medium",
      idempotency: "none",
      supportsDryRun: true,
      concurrencyKey: (input) => writeConcurrencyKey(input, workspaceSettings),
      runtimeContract: singleFileRuntimeContract({ workspaceSettings, retryMode: "manual_only" }),
      async execute(input, context = {}) {
        const resolved = resolveWorkspaceWritePath(input.path, { workspaceSettings, allowCreateDirectories: input.createDirectories });
        const existing = await inspectFile(resolved, maxWriteFileBytes);
        if (!existing && !input.createIfMissing) throw writeError("PATH_NOT_FOUND", "目标文件不存在；如需创建，请显式设置 createIfMissing=true。");
        assertExpectedHash(input.expectedSha256, existing?.sha256 ?? "");
        const codec = resolveWriteCodec({ requestedEncoding: input.encoding, existing, preserveNewline: true, content: input.content });
        let appendText = existing ? normalizeTextNewlines(input.content, existing.newline) : input.content;
        const separator = existing && input.ensureNewline && existing.text && !/(?:\r\n|\r|\n)$/u.test(existing.text)
          ? newlineSequence(["lf", "crlf", "cr"].includes(existing.newline) ? existing.newline : "lf")
          : "";
        const nextText = `${existing?.text ?? ""}${separator}${appendText}`;
        const desired = encodeTextBuffer(nextText, codec);
        if (desired.length > maxWriteFileBytes) throw writeError("FILE_TOO_LARGE", "追加后的文件超过写工具上限。");
        const appendBuffer = encodeTextBuffer(`${separator}${appendText}`, { encoding: codec.encoding, bom: false });
        const afterSha256 = sha256Buffer(desired);
        const summary = lineSummary(existing?.text ?? "", nextText);
        const effectEvidence = fileEvidence({ operation: "append_text_file", relativePath: resolved.relativePath, beforeSha256: existing?.sha256 ?? "", afterSha256, beforeBytes: existing?.sizeBytes ?? 0, afterBytes: desired.length, dryRun: input.dryRun, created: !existing });
        if (!input.dryRun) {
          await atomicWriteFileBuffer({
            targetPath: resolved.path, buffer: desired, expectedSha256: input.expectedSha256,
            createDirectories: input.createDirectories, createOnly: !existing, overwrite: true,
            idempotencyKey: context.idempotencyKey || context.callId, abortSignal: context.abortSignal, onBoundary: context.onWriteBoundary
          });
        }
        return {
          ok: true,
          data: {
            path: resolved.relativePath, changed: true, created: !existing, dryRun: input.dryRun, appendedBytes: appendBuffer.length,
            beforeSha256: existing?.sha256 ?? "", afterSha256, beforeBytes: existing?.sizeBytes ?? 0, bytes: desired.length,
            encoding: codec.encoding, bom: codec.bom, newline: codec.newline, atomic: true,
            ...receiptFields(effectEvidence, summary)
          }
        };
      }
    },
    {
      name: "create_directory",
      version: 1,
      title: "Create directory",
      description: "Create one safe directory inside the authorized workspace. Recursive parent creation must be explicit. The operation is idempotent, supports dry-run, and produces a durable receipt.",
      inputSchema: z.object({ path: pathSchema, recursive: z.boolean().default(false), dryRun: z.boolean().default(false) }),
      outputSchema: z.object({
        ok: z.literal(true),
        data: z.object({ path: z.string(), changed: z.boolean(), created: z.boolean(), dryRun: z.boolean(), atomic: z.boolean(), ...receiptSchemaFields })
      }),
      sideEffect: "write",
      riskLevel: "medium",
      idempotency: "natural",
      supportsDryRun: true,
      concurrencyKey: (input) => writeConcurrencyKey(input, workspaceSettings),
      runtimeContract: createDirectoryRuntimeContract(workspaceSettings),
      async execute(input, context = {}) {
        throwIfAborted(context.abortSignal);
        const resolved = resolveWorkspaceMutationPath(input.path, {
          workspaceSettings, allowCreateParents: input.recursive, mustExist: false, allowFile: false, allowDirectory: true
        });
        const effectEvidence = {
          kind: "workspace_directory_v2", operation: "create_directory", affectedPaths: [resolved.relativePath], bytesChanged: 0,
          atomic: true, dryRun: input.dryRun, created: !resolved.exists
        };
        if (!input.dryRun && !resolved.exists) {
          await context.onWriteBoundary?.("before_directory_create", { targetPath: resolved.path });
          await fs.promises.mkdir(resolved.path, { recursive: input.recursive });
          const stat = await fs.promises.lstat(resolved.path);
          if (!stat.isDirectory()) throw writeError("DIRECTORY_CREATE_VERIFY_FAILED", "目录创建后的核验失败。");
          await context.onWriteBoundary?.("after_directory_create", { targetPath: resolved.path });
        }
        return { ok: true, data: { path: resolved.relativePath, changed: !resolved.exists, created: !resolved.exists, dryRun: input.dryRun, atomic: true, ...receiptFields(effectEvidence) } };
      }
    },
    {
      name: "move_path",
      version: 1,
      title: "Move path",
      description: "Atomically rename or move one safe file or directory within the same authorized workspace. Existing destinations are never overwritten. Supports dry-run, optional file hash preconditions, verification, and rollback on detected failure.",
      inputSchema: z.object({
        source: pathSchema,
        destination: pathSchema,
        expectedSha256: hashSchema,
        createDirectories: z.boolean().default(false),
        overwrite: z.boolean().default(false),
        dryRun: z.boolean().default(false)
      }),
      outputSchema: z.object({
        ok: z.literal(true),
        data: z.object({
          source: z.string(), destination: z.string(), type: z.enum(["file", "directory"]), changed: z.boolean(), dryRun: z.boolean(),
          beforeSha256: z.string(), afterSha256: z.string(), bytes: z.number().int().nonnegative(), atomic: z.boolean(),
          ...receiptSchemaFields
        })
      }),
      sideEffect: "write",
      riskLevel: "medium",
      idempotency: "none",
      supportsDryRun: true,
      concurrencyKey: (input) => writeConcurrencyKey(input, workspaceSettings, ["source", "destination"]),
      runtimeContract: moveRuntimeContract(workspaceSettings),
      async execute(input, context = {}) {
        if (input.overwrite) throw writeError("OVERWRITE_NOT_SUPPORTED", "move_path 暂不允许覆盖已有目标；请先选择新路径。");
        const source = resolveWorkspaceMutationPath(input.source, {
          workspaceSettings, mustExist: true, allowFile: true, allowDirectory: true
        });
        const destination = resolveWorkspaceMutationPath(input.destination, {
          workspaceSettings: { ...workspaceSettings, roots: [source.root] }, allowCreateParents: input.createDirectories,
          mustExist: false, allowFile: true, allowDirectory: true
        });
        if (destination.exists) throw writeError("DESTINATION_EXISTS", "目标路径已存在，拒绝覆盖。");
        if (source.type === "directory" && (destination.path === source.path || destination.path.startsWith(`${source.path}${path.sep}`))) {
          throw writeError("MOVE_INTO_SELF", "不能把目录移动到自身内部。");
        }
        let hash = "";
        let bytes = 0;
        if (source.type === "file") {
          const current = await sha256File(source.path, { maxBytes: maxWriteFileBytes });
          hash = current.sha256;
          bytes = current.bytes;
          assertExpectedHash(input.expectedSha256, hash);
        } else if (input.expectedSha256) {
          throw writeError("HASH_NOT_SUPPORTED_FOR_DIRECTORY", "目录移动不支持 expectedSha256。");
        }
        const effectEvidence = fileEvidence({
          operation: "move_path", relativePath: destination.relativePath, beforeSha256: hash, afterSha256: hash,
          beforeBytes: bytes, afterBytes: bytes, dryRun: input.dryRun, movedFrom: source.relativePath, movedTo: destination.relativePath
        });
        effectEvidence.affectedPaths = [source.relativePath, destination.relativePath];
        if (!input.dryRun) {
          if (input.createDirectories) await fs.promises.mkdir(path.dirname(destination.path), { recursive: true });
          await context.onWriteBoundary?.("before_move", { sourcePath: source.path, destinationPath: destination.path });
          try {
            await fs.promises.rename(source.path, destination.path);
          } catch (error) {
            if (error?.code === "EXDEV") throw writeError("MOVE_CROSS_DEVICE", "跨文件系统移动不是原子操作，已拒绝执行。");
            throw error;
          }
          try {
            const moved = await fs.promises.lstat(destination.path);
            if (source.type === "file") {
              if (!moved.isFile()) throw writeError("MOVE_VERIFY_FAILED", "移动后的文件类型核验失败。");
              const verified = await sha256File(destination.path, { maxBytes: maxWriteFileBytes });
              if (verified.sha256 !== hash) throw writeError("MOVE_VERIFY_FAILED", "移动后的文件哈希核验失败。");
            } else if (!moved.isDirectory()) {
              throw writeError("MOVE_VERIFY_FAILED", "移动后的目录类型核验失败。");
            }
          } catch (error) {
            await fs.promises.rename(destination.path, source.path).catch(() => {});
            error.details = { ...(error.details ?? {}), rollbackPerformed: fs.existsSync(source.path) };
            throw error;
          }
          await context.onWriteBoundary?.("after_move", { sourcePath: source.path, destinationPath: destination.path });
        }
        return {
          ok: true,
          data: {
            source: source.relativePath, destination: destination.relativePath, type: source.type, changed: true, dryRun: input.dryRun,
            beforeSha256: hash, afterSha256: hash, bytes, atomic: true,
            ...receiptFields(effectEvidence)
          }
        };
      }
    },
    {
      name: "apply_patch",
      version: 1,
      title: "Apply unified patch",
      description: "Parse, dry-run, and transactionally apply a bounded multi-file unified diff. Every hunk is validated before any mutation; all files commit together or are rolled back together. Deletions, renames, absolute paths, traversal, sensitive paths, and excluded directories are blocked.",
      inputSchema: z.object({
        patch: z.string().min(1).max(maxPatchBytes),
        expectedSha256: z.record(z.string(), z.string().regex(HASH_PATTERN)).default({}),
        createDirectories: z.boolean().default(false),
        dryRun: z.boolean().default(false)
      }),
      outputSchema: z.object({
        ok: z.literal(true),
        data: z.object({
          changed: z.boolean(), dryRun: z.boolean(), atomic: z.boolean(), fileCount: z.number().int().positive(),
          files: z.array(z.object({
            path: z.string(), created: z.boolean(), beforeSha256: z.string(), afterSha256: z.string(),
            beforeBytes: z.number().int().nonnegative(), bytes: z.number().int().nonnegative(), addedLines: z.number().int().nonnegative(), removedLines: z.number().int().nonnegative()
          })),
          ...receiptSchemaFields
        })
      }),
      sideEffect: "write",
      riskLevel: "medium",
      idempotency: "none",
      supportsDryRun: true,
      concurrencyKey: (input) => `workspace-patch:${crypto.createHash("sha256").update(String(input?.patch ?? "")).digest("hex")}`,
      runtimeContract: {
        effect: "local_write", retryMode: "manual_only", supportsAbort: true, supportsResume: false,
        leaseTtlMs: 120_000, heartbeatMs: 5_000,
        async verify({ receipt, input }) {
          if (dryRunVerification(receipt, input)) return { status: "valid", evidence: { kind: "dry_run", dryRun: true } };
          const evidence = receipt?.metadata?.effectEvidence ?? receipt?.output?.data?.effectEvidence;
          if (!Array.isArray(evidence?.files)) return { status: "unknown", evidence: { reason: "missing_patch_evidence" } };
          try {
            for (const item of evidence.files) {
              const resolved = resolveWorkspaceWritePath(item.path, { workspaceSettings, allowCreateDirectories: true });
              const current = await sha256File(resolved.path, { maxBytes: maxWriteFileBytes });
              if (current.sha256 !== item.afterSha256) return { status: "not_applied", evidence: { ...evidence, mismatchPath: item.path, actualSha256: current.sha256 } };
            }
            return { status: "valid", evidence };
          } catch (error) {
            return { status: "unknown", evidence: { ...evidence, error: error instanceof Error ? error.message : String(error) } };
          }
        },
        async reconcile({ input }) {
          return input?.dryRun
            ? { status: "applied", evidence: { kind: "dry_run", dryRun: true } }
            : { status: "unknown", evidence: { reason: "multi_file_patch_requires_manual_reconciliation" } };
        }
      },
      async execute(input, context = {}) {
        const parsed = parseUnifiedPatch(input.patch, { maxFiles: maxPatchFiles, maxHunks: maxPatchFiles * 20 });
        const prepared = [];
        let commonRoot = "";
        for (const file of parsed.files) {
          const resolved = resolveWorkspaceWritePath(file.path, {
            workspaceSettings: commonRoot ? { ...workspaceSettings, roots: [commonRoot] } : workspaceSettings,
            allowCreateDirectories: input.createDirectories
          });
          commonRoot ||= resolved.root;
          const existing = await inspectFile(resolved, maxWriteFileBytes);
          if (file.created && existing) throw writeError("FILE_EXISTS", `补丁要创建的文件 ${file.path} 已存在。`);
          if (!file.created && !existing) throw writeError("PATH_NOT_FOUND", `补丁目标文件 ${file.path} 不存在。`);
          const expected = input.expectedSha256[file.path] ?? input.expectedSha256[resolved.relativePath] ?? "";
          assertExpectedHash(expected, existing?.sha256 ?? "");
          const currentText = existing?.text ?? "";
          const patchedLf = applyUnifiedFilePatch(currentText, file);
          const nextText = existing && ["lf", "crlf", "cr"].includes(existing.newline)
            ? normalizeTextNewlines(patchedLf, existing.newline)
            : patchedLf;
          const codec = existing ?? { encoding: "utf8", bom: false, newline: "lf" };
          const buffer = encodeTextBuffer(nextText, codec);
          if (buffer.length > maxWriteFileBytes) throw writeError("FILE_TOO_LARGE", `补丁后的文件 ${file.path} 超过写工具上限。`);
          prepared.push({
            targetPath: resolved.path, path: resolved.relativePath, buffer, expectedSha256: expected,
            createOnly: file.created, createDirectories: input.createDirectories,
            created: file.created, beforeSha256: existing?.sha256 ?? "", beforeBytes: existing?.sizeBytes ?? 0,
            afterSha256: sha256Buffer(buffer), afterBytes: buffer.length, addedLines: file.addedLines, removedLines: file.removedLines
          });
        }
        const evidence = transactionEvidence({ operation: "apply_patch", files: prepared.map((item) => ({
          path: item.path, beforeSha256: item.beforeSha256, afterSha256: item.afterSha256,
          beforeBytes: item.beforeBytes, afterBytes: item.afterBytes, created: item.created
        })), dryRun: input.dryRun });
        let rollbackPerformed = false;
        if (!input.dryRun) {
          const transaction = await atomicWriteFileTransaction({
            entries: prepared,
            idempotencyKey: context.idempotencyKey || context.callId,
            abortSignal: context.abortSignal,
            onBoundary: context.onWriteBoundary
          });
          rollbackPerformed = transaction.rollbackPerformed;
          evidence.rollbackPerformed = rollbackPerformed;
        }
        return {
          ok: true,
          data: {
            changed: true, dryRun: input.dryRun, atomic: true, fileCount: prepared.length,
            files: prepared.map((item) => ({
              path: item.path, created: item.created, beforeSha256: item.beforeSha256, afterSha256: item.afterSha256,
              beforeBytes: item.beforeBytes, bytes: item.afterBytes, addedLines: item.addedLines, removedLines: item.removedLines
            })),
            ...receiptFields(evidence, { rollbackPerformed, addedLines: parsed.addedLines, removedLines: parsed.removedLines })
          }
        };
      }
    }
  ];
}
