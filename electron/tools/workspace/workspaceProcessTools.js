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

const BLOCKED_GIT_OPTIONS = [
  "-c",
  "--config",
  "--config-env",
  "--exec-path",
  "--ext-diff",
  "--textconv",
  "--no-index",
  "--output",
  "--output-indicator-new",
  "--output-indicator-old",
  "--output-indicator-context",
  "--pathspec-from-file",
  "--exclude-from",
  "--git-dir",
  "--work-tree",
  "--namespace"
];

const MUTATING_BRANCH_OPTIONS = new Set([
  "-d",
  "-D",
  "-m",
  "-M",
  "-c",
  "-C",
  "-f",
  "--delete",
  "--move",
  "--copy",
  "--force",
  "--edit-description",
  "--set-upstream-to",
  "--unset-upstream",
  "--create-reflog"
]);

const SAFE_BRANCH_OPTIONS = new Set([
  "-a",
  "-r",
  "-v",
  "-vv",
  "--all",
  "--remotes",
  "--verbose",
  "--list",
  "--show-current",
  "--merged",
  "--no-merged",
  "--contains",
  "--no-contains",
  "--points-at",
  "--format",
  "--sort",
  "--column",
  "--no-column",
  "--color",
  "--no-color",
  "--ignore-case"
]);

const SAFE_GIT_ENV = Object.freeze({
  GIT_PAGER: "cat",
  PAGER: "cat",
  GIT_EXTERNAL_DIFF: "",
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0"
});

function processToolError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function containsControlCharacter(value) {
  for (const character of String(value ?? "")) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 31 || code === 127) {
      return true;
    }
  }
  return false;
}

function optionName(value) {
  const text = String(value ?? "");
  const separator = text.indexOf("=");
  return separator >= 0 ? text.slice(0, separator) : text;
}

function isBlockedGitOption(value) {
  const name = optionName(value);
  return BLOCKED_GIT_OPTIONS.some((blocked) =>
    name === blocked || name.startsWith(`${blocked}=`)
  );
}

function validateRelativePathspec(value) {
  const text = String(value ?? "");
  if (!text || text === ".") {
    return;
  }
  if (
    path.isAbsolute(text) ||
    path.win32.isAbsolute(text) ||
    text.split(/[\\/]+/u).includes("..")
  ) {
    throw processToolError(
      "GIT_PATHSPEC_BLOCKED",
      `Git 路径参数必须位于当前工作区内：${text}`
    );
  }
}

function validateGitArgs(command, args) {
  for (const argument of args) {
    if (containsControlCharacter(argument)) {
      throw processToolError(
        "GIT_ARGUMENT_BLOCKED",
        "Git 参数不能包含控制字符。"
      );
    }
    if (isBlockedGitOption(argument)) {
      throw processToolError(
        "GIT_OPTION_BLOCKED",
        `Git 参数 ${argument} 可能写入文件、执行外部程序或绕过工作区边界。`
      );
    }
  }

  const separatorIndex = args.indexOf("--");
  if (separatorIndex >= 0) {
    for (const pathspec of args.slice(separatorIndex + 1)) {
      validateRelativePathspec(pathspec);
    }
  }

  if (command === "branch") {
    for (const argument of args) {
      const name = optionName(argument);
      if (MUTATING_BRANCH_OPTIONS.has(name)) {
        throw processToolError(
          "GIT_COMMAND_BLOCKED",
          `git branch 参数 ${argument} 会修改仓库，因此已被拒绝。`
        );
      }
      if (argument.startsWith("-") && !SAFE_BRANCH_OPTIONS.has(name)) {
        throw processToolError(
          "GIT_OPTION_BLOCKED",
          `git branch 参数 ${argument} 不在只读允许列表中。`
        );
      }
    }
  }
}

function buildGitArgs(command, args) {
  validateGitArgs(command, args);

  if (command === "branch") {
    if (args.some((argument) => optionName(argument) === "--show-current")) {
      return ["--no-pager", "branch", ...args];
    }
    return ["--no-pager", "branch", "--list", ...args];
  }

  if (["diff", "log", "show"].includes(command)) {
    return [
      "--no-pager",
      command,
      "--no-ext-diff",
      "--no-textconv",
      ...args
    ];
  }

  return ["--no-pager", command, ...args];
}

function normalizeConfiguredCommand(value) {
  const text = String(value ?? "").trim();
  if (!text || containsControlCharacter(text)) {
    return null;
  }
  const absolute = path.isAbsolute(text) || path.win32.isAbsolute(text);
  return {
    value: absolute ? path.normalize(text) : text,
    absolute
  };
}

function commandMatches(configured, requested) {
  if (configured.absolute) {
    if (!(path.isAbsolute(requested) || path.win32.isAbsolute(requested))) {
      return false;
    }
    const left = path.normalize(configured.value);
    const right = path.normalize(requested);
    return process.platform === "win32"
      ? left.toLowerCase() === right.toLowerCase()
      : left === right;
  }

  return (
    requested === configured.value &&
    !requested.includes("/") &&
    !requested.includes("\\")
  );
}

function resolveAllowedCommand(input, allowedCommands) {
  const requested = String(input ?? "").trim();
  if (!requested || containsControlCharacter(requested)) {
    throw processToolError(
      "COMMAND_NOT_ALLOWED",
      "命令为空或包含非法控制字符。"
    );
  }

  const match = allowedCommands.find((configured) =>
    commandMatches(configured, requested)
  );
  if (!match) {
    throw processToolError(
      "COMMAND_NOT_ALLOWED",
      `命令 ${requested} 未在开发者明确配置的允许列表中。`
    );
  }
  return match.value;
}

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
      stdoutBytes: outcome.stdoutBytes ?? Buffer.byteLength(outcome.stdout ?? ""),
      stderrBytes: outcome.stderrBytes ?? Buffer.byteLength(outcome.stderr ?? ""),
      stdoutTruncated: outcome.stdoutTruncated === true,
      stderrTruncated: outcome.stderrTruncated === true,
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

const processOutputSchema = z.object({
  ok: z.boolean(),
  data: z.object({
    command: z.string(),
    args: z.array(z.string()),
    cwd: z.string(),
    exitCode: z.number().nullable(),
    signal: z.string().nullable(),
    stdout: z.string(),
    stderr: z.string(),
    stdoutBytes: z.number().int().nonnegative(),
    stderrBytes: z.number().int().nonnegative(),
    stdoutTruncated: z.boolean(),
    stderrTruncated: z.boolean(),
    durationMs: z.number().nonnegative(),
    terminated: z.boolean(),
    terminationReason: z.string().nullable()
  }),
  error: z.object({
    code: z.string(),
    type: z.string(),
    category: z.string(),
    message: z.string(),
    retryable: z.boolean()
  }).optional()
});

export function createWorkspaceProcessToolDefinitions(
  workspaceSettings = {}
) {
  const allowedCommands = (
    Array.isArray(workspaceSettings.allowedCommands)
      ? workspaceSettings.allowedCommands.slice(0, 32)
      : []
  )
    .map(normalizeConfiguredCommand)
    .filter(Boolean);

  const resolveCwd = (value = ".") => resolveWorkspacePath(value, {
    allowFile: false,
    workspaceSettings
  });

  return [
    {
      name: "git_inspect",
      title: "Inspect Git repository",
      description:
        "Run a conservative read-only Git inspection command inside the authorized workspace. Mutating branch flags, output redirection options, external diff/textconv execution, unsafe pathspecs, shell expansion, and interactive prompts are blocked.",
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
      outputSchema: processOutputSchema,
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
          throw processToolError(
            "GIT_COMMAND_BLOCKED",
            "该 Git 子命令不在只读允许列表中。"
          );
        }
        if (!context.subprocessSupervisor) {
          throw processToolError(
            "SUBPROCESS_SUPERVISOR_UNAVAILABLE",
            "受控子进程运行器不可用。"
          );
        }
        const resolved = resolveCwd(input.cwd);
        const args = buildGitArgs(input.command, input.args);
        const outcome = await context.subprocessSupervisor.run(
          "git",
          args,
          {
            cwd: resolved.path,
            timeoutMs: input.timeoutMs,
            abortSignal: context.abortSignal,
            shell: false,
            env: {
              ...process.env,
              ...SAFE_GIT_ENV
            }
          }
        );
        return executionResult("git", args, resolved.relativePath, outcome);
      }
    },
    {
      name: "run_workspace_command",
      title: "Run workspace command",
      description:
        "Run one developer-configured executable with a literal argument array inside the authorized workspace. No shell is used and the process tree is supervised for timeout, cancellation, and bounded output. This is not an operating-system sandbox; only explicitly trusted commands should be enabled.",
      inputSchema: z.object({
        command: z.string().min(1).max(500),
        args: z.array(z.string().max(1_000)).max(64).default([]),
        cwd: z.string().max(500).default("."),
        stdin: z.string().max(100_000).optional(),
        timeoutMs: z.number().int().min(1_000).max(600_000).default(60_000)
      }),
      outputSchema: processOutputSchema,
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
        if (!context.subprocessSupervisor) {
          throw processToolError(
            "SUBPROCESS_SUPERVISOR_UNAVAILABLE",
            "受控子进程运行器不可用。"
          );
        }
        const command = resolveAllowedCommand(input.command, allowedCommands);
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
