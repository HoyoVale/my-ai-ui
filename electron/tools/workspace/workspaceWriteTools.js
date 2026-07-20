import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import {
  atomicWriteTextFile,
  sha256File,
  sha256Text
} from "./atomicFileWriter.js";

import {
  resolveWorkspaceWritePath
} from "./workspacePolicy.js";

function evidenceFrom({ resolved, write }) {
  return {
    kind: "workspace_file_sha256",
    relativePath: resolved.relativePath,
    sha256: write.afterSha256,
    bytes: write.bytes,
    atomic: write.atomic === true
  };
}

function desiredHash(input) {
  return sha256Text(input?.content ?? "", input?.encoding ?? "utf8");
}

async function inspectTarget(input, workspaceSettings) {
  const resolved = resolveWorkspaceWritePath(input?.path, {
    workspaceSettings,
    allowCreateDirectories: input?.createDirectories === true
  });
  const stat = await fs.promises.lstat(resolved.path).catch((error) => {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (!stat) {
    return {
      resolved,
      exists: false,
      sha256: "",
      bytes: 0
    };
  }
  if (stat.isSymbolicLink()) {
    const error = new Error("拒绝核验符号链接目标。");
    error.code = "SYMLINK_WRITE_BLOCKED";
    throw error;
  }
  const current = await sha256File(resolved.path, {
    maxBytes: workspaceSettings.maxWriteFileBytes ?? 5_000_000
  });
  return {
    resolved,
    exists: true,
    ...current
  };
}

export function createWorkspaceWriteToolDefinitions(
  workspaceSettings = {}
) {
  const maxWriteFileBytes = Math.min(
    20_000_000,
    Math.max(
      1_024,
      Number(workspaceSettings.maxWriteFileBytes) || 5_000_000
    )
  );

  const inputSchema = z.object({
    path: z.string().min(1).max(500),
    content: z.string().max(maxWriteFileBytes),
    encoding: z.enum(["utf8"]).default("utf8"),
    expectedSha256: z.string()
      .regex(/^[a-fA-F0-9]{64}$/u)
      .optional()
      .default(""),
    createDirectories: z.boolean().default(false)
  });

  const runtimeContract = {
    effect: "local_write",
    retryMode: "idempotency_key",
    supportsAbort: true,
    supportsResume: true,
    leaseTtlMs: 60_000,
    heartbeatMs: 5_000,
    async verify({ receipt, input }) {
      const expected = String(
        receipt?.metadata?.effectEvidence?.sha256 ??
        receipt?.output?.data?.effectEvidence?.sha256 ??
        desiredHash(input)
      );
      try {
        const target = await inspectTarget(input, workspaceSettings);
        return target.exists && target.sha256 === expected
          ? {
              status: "valid",
              evidence: {
                kind: "workspace_file_sha256",
                relativePath: target.resolved.relativePath,
                sha256: target.sha256,
                bytes: target.bytes
              }
            }
          : {
              status: "not_applied",
              evidence: {
                kind: "workspace_file_sha256",
                relativePath: target.resolved.relativePath,
                expectedSha256: expected,
                actualSha256: target.sha256,
                exists: target.exists
              }
            };
      } catch (error) {
        return {
          status: "unknown",
          evidence: {
            error: error instanceof Error ? error.message : String(error)
          }
        };
      }
    },
    async reconcile({ input }) {
      try {
        const target = await inspectTarget(input, workspaceSettings);
        const expected = desiredHash(input);
        if (target.exists && target.sha256 === expected) {
          const effectEvidence = {
            kind: "workspace_file_sha256",
            relativePath: target.resolved.relativePath,
            sha256: target.sha256,
            bytes: target.bytes,
            atomic: true
          };
          return {
            status: "applied",
            output: {
              ok: true,
              data: {
                path: target.resolved.relativePath,
                changed: false,
                created: false,
                afterSha256: target.sha256,
                bytes: target.bytes,
                atomic: true,
                reconciled: true,
                effectEvidence
              }
            },
            result: {
              status: "success",
              summary: `已核验文件 ${target.resolved.relativePath}`,
              preview: target.sha256,
              truncated: false,
              clipped: false
            },
            evidence: effectEvidence
          };
        }
        return {
          status: "not_applied",
          evidence: {
            kind: "workspace_file_sha256",
            relativePath: target.resolved.relativePath,
            expectedSha256: expected,
            actualSha256: target.sha256,
            exists: target.exists
          }
        };
      } catch (error) {
        return {
          status: "unknown",
          evidence: {
            error: error instanceof Error ? error.message : String(error)
          }
        };
      }
    }
  };

  return [
    {
      name: "write_text_file",
      title: "Write text file",
      description:
        "Atomically create or replace one text file inside the authorized workspace. The write uses a same-directory temporary file, fsync, atomic rename, SHA-256 verification, optimistic concurrency, and durable receipts.",
      inputSchema,
      outputSchema: z.object({
        ok: z.literal(true),
        data: z.object({
          path: z.string(),
          changed: z.boolean(),
          created: z.boolean(),
          beforeSha256: z.string(),
          afterSha256: z.string(),
          bytes: z.number().int().nonnegative(),
          atomic: z.boolean(),
          idempotentReplay: z.boolean(),
          effectEvidence: z.object({
            kind: z.literal("workspace_file_sha256"),
            relativePath: z.string(),
            sha256: z.string(),
            bytes: z.number().int().nonnegative(),
            atomic: z.boolean()
          })
        })
      }),
      sideEffect: "write",
      riskLevel: "medium",
      idempotency: "natural",
      concurrencyKey(input) {
        try {
          const resolved = resolveWorkspaceWritePath(input?.path, {
            workspaceSettings,
            allowCreateDirectories: input?.createDirectories === true
          });
          const normalized = path.normalize(resolved.path);
          return `workspace-file:${
            process.platform === "win32"
              ? normalized.toLowerCase()
              : normalized
          }`;
        } catch {
          return `workspace-file:${path.normalize(String(input?.path ?? ""))}`;
        }
      },
      runtimeContract,
      async execute(input, context = {}) {
        const resolved = resolveWorkspaceWritePath(input.path, {
          workspaceSettings,
          allowCreateDirectories: input.createDirectories
        });
        const contentBytes = Buffer.byteLength(input.content, input.encoding);
        if (contentBytes > maxWriteFileBytes) {
          const error = new Error("写入内容超过工作区写工具上限。");
          error.code = "FILE_TOO_LARGE";
          throw error;
        }
        const write = await atomicWriteTextFile({
          targetPath: resolved.path,
          content: input.content,
          encoding: input.encoding,
          expectedSha256: input.expectedSha256,
          createDirectories: input.createDirectories,
          idempotencyKey: context.idempotencyKey || context.callId,
          abortSignal: context.abortSignal,
          onBoundary: context.onWriteBoundary
        });
        const effectEvidence = evidenceFrom({ resolved, write });
        return {
          ok: true,
          data: {
            path: resolved.relativePath,
            changed: write.changed,
            created: write.created,
            beforeSha256: write.beforeSha256,
            afterSha256: write.afterSha256,
            bytes: write.bytes,
            atomic: write.atomic,
            idempotentReplay: write.idempotentReplay,
            effectEvidence
          }
        };
      }
    }
  ];
}
