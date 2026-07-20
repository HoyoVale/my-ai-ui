import path from "node:path";

import { z } from "zod";

import {
  resolveWorkspacePath
} from "./workspacePolicy.js";

const SAFE_GIT_SUBCOMMANDS = new Set([
  "status",
  "diff",
  "log",
  "show",
  "branch",
  "rev-parse",
  "ls-files"
]);

const DEFAULT_COMMAND_ALLOWLIST = new Set([
  "node",
  "npm",
  "npx",
  "python",
  "python3",
  "pytest",
  "cargo",
  "go",
  "cmake"
]);

function bounded(value, max = 200_000) {
  const text = String(value ?? "");
  return text.length > max
    ? `${text.slice(0, max)}\n…[truncated]`
    : text;
}

function executionResult(command, args, cwd, outcome) {
  return {
    ok: outcome.ok,
    data: {
      command,
      args,
      cwd,
      exitCode: outcome.code,
      signal: outcome.signal,
      stdout: bounded(outcome.stdout),
      stderr: bounded(outcome.stderr),
      durationMs: outcome.durationMs,
      terminated: outcome.terminated,
      terminationReason: outcome.terminationReason
    },
    ...(outcome.ok
      ? {}
      : {
          error: {
            code: outcome.terminationReason === "timeout"
              ? "SUBPROCESS_TIMEOUT"
              : outcome.terminationReason === "abort"
                ? "CANCELLED_BY_USER"
                : "SUBPROCESS_FAILED",
            type: outcome.terminationReason === "timeout"
              ? "TIMEOUT"
              : outcome.terminationReason === "abort"
                ? "CANCELLED"
                : "EXECUTION_FAILED",
            category: outcome.terminationReason === "timeout"
              ? "timeout"
              : outcome.terminationReason === "abort"
                ? "cancelled"
                : "execution",
            message: outcome.terminationReason
              ? `进程因 ${outcome.terminationReason} 被终止。`
              : `进程退出码为 ${outcome.code}。`,
            retryable: false
          }
        })
  };
}

export function createWorkspaceProcessToolDefinitions(
  workspaceSettings = {}
) {
  const allowedCommands = new Set([
    ...DEFAULT_COMMAND_ALLOWLIST,
    ...(Array.isArray(workspaceSettings.allowedCommands)
      ? workspaceSettings.allowedCommands.map(String)
      : [])
  ]);

  const resolveCwd = (value = ".") => resolveWorkspacePath(value, {
    allowFile: false,
    workspaceSettings
  });

  return [
    {
      name: "git_inspect",
      title: "Inspect Git repository",
      description:
        "Run a read-only Git inspection command inside the authorized workspace through the supervised subprocess runtime. Shell expansion is never enabled.",
      inputSchema: z.object({
        command: z.enum([
          "status",
          "diff",
          "log",
          "show",
          "branch",
          "rev-parse",
          "ls-files"
        ]),
        args: z.array(z.string().max(500)).max(32).default([]),
        cwd: z.string().max(500).default("."),
        timeoutMs: z.number().int().min(1_000).max(120_000).default(30_000)
      }),
      sideEffect: "read",
      riskLevel: "low",
      timeoutMs: 120_000,
      retryPolicy: { maxAttempts: 1 },
      runtimeContract: {
        effect: "read",
        retryMode: "safe",
        supportsAbort: true,
        supportsResume: true
      },
      async execute(input, context = {}) {
        if (!SAFE_GIT_SUBCOMMANDS.has(input.command)) {
          const error = new Error("该 Git 子命令不在只读允许列表中。");
          error.code = "GIT_COMMAND_BLOCKED";
          throw error;
        }
        const resolved = resolveCwd(input.cwd);
        const args = ["--no-pager", input.command, ...input.args];
        const outcome = await context.subprocessSupervisor.run(
          "git",
          args,
          {
            cwd: resolved.path,
            timeoutMs: input.timeoutMs,
            abortSignal: context.abortSignal,
            shell: false
          }
        );
        return executionResult("git", args, resolved.relativePath, outcome);
      }
    },
    {
      name: "run_workspace_command",
      title: "Run workspace command",
      description:
        "Run one allowlisted executable with an argument array inside the authorized workspace. It never invokes a shell and is supervised for timeout, cancellation, output bounds, and process-tree termination.",
      inputSchema: z.object({
        command: z.string().min(1).max(120),
        args: z.array(z.string().max(1_000)).max(64).default([]),
        cwd: z.string().max(500).default("."),
        stdin: z.string().max(100_000).optional(),
        timeoutMs: z.number().int().min(1_000).max(600_000).default(60_000)
      }),
      sideEffect: "external",
      riskLevel: "high",
      idempotency: "none",
      timeoutMs: 600_000,
      retryPolicy: { maxAttempts: 1 },
      concurrencyKey(input) {
        return `workspace-command:${path.normalize(String(input?.cwd ?? "."))}`;
      },
      runtimeContract: {
        effect: "destructive",
        retryMode: "manual_only",
        supportsAbort: true,
        supportsResume: false,
        leaseTtlMs: 660_000,
        heartbeatMs: 5_000
      },
      async execute(input, context = {}) {
        const command = path.basename(String(input.command ?? ""));
        if (!allowedCommands.has(command)) {
          const error = new Error(`命令 ${command} 不在允许列表中。`);
          error.code = "COMMAND_NOT_ALLOWED";
          throw error;
        }
        const resolved = resolveCwd(input.cwd);
        const outcome = await context.subprocessSupervisor.run(
          command,
          input.args,
          {
            cwd: resolved.path,
            stdin: input.stdin,
            timeoutMs: input.timeoutMs,
            abortSignal: context.abortSignal,
            shell: false
          }
        );
        return executionResult(command, input.args, resolved.relativePath, outcome);
      }
    }
  ];
}
