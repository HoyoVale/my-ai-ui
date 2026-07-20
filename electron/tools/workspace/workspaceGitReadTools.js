import path from "node:path";

import { z } from "zod";

import {
  isExcludedWorkspacePath,
  isSensitiveWorkspacePath,
  resolveWorkspacePath
} from "./workspacePolicy.js";

const SAFE_GIT_ENV = Object.freeze({
  GIT_PAGER: "cat",
  PAGER: "cat",
  GIT_EXTERNAL_DIFF: "",
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0"
});
const REVISION_PATTERN = /^[a-zA-Z0-9_./@{}^~:+-]{1,200}$/u;
const FIXED_EXCLUDE_PATHS = Object.freeze([
  ":(exclude)**/.env",
  ":(exclude)**/.env.*",
  ":(exclude)**/.npmrc",
  ":(exclude)**/.pypirc",
  ":(exclude)**/*.pem",
  ":(exclude)**/*.key",
  ":(exclude)**/*.p12",
  ":(exclude)**/*.pfx",
  ":(exclude)**/id_rsa*",
  ":(exclude)**/id_dsa*",
  ":(exclude)**/id_ecdsa*",
  ":(exclude)**/id_ed25519*",
  ":(exclude)**/credentials*",
  ":(exclude)**/secret*",
  ":(exclude)**/.aws/**",
  ":(exclude)**/.azure/**",
  ":(exclude)**/.kube/**",
  ":(exclude)**/.ssh/**",
  ":(exclude)**/node_modules/**",
  ":(exclude)**/dist/**",
  ":(exclude)**/build/**",
  ":(exclude)**/coverage/**",
  ":(exclude)**/.cache/**",
  ":(exclude)**/.next/**",
  ":(exclude)**/.vite/**",
  ":(exclude)**/test-results/**",
  ":(exclude)**/playwright-report/**"
]);

function gitToolError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function containsControlCharacter(value) {
  for (const character of String(value ?? "")) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function validatePathspec(value, root) {
  const text = String(value ?? "").trim();
  if (!text || text === ".") return ".";
  if (
    path.isAbsolute(text) ||
    path.win32.isAbsolute(text) ||
    text.split(/[\\/]+/u).includes("..") ||
    containsControlCharacter(text)
  ) {
    throw gitToolError(
      "GIT_PATHSPEC_BLOCKED",
      `Git 路径参数必须是工作区内的安全相对路径：${text}`
    );
  }
  const candidate = path.resolve(root, text);
  if (isExcludedWorkspacePath(candidate) || isSensitiveWorkspacePath(candidate)) {
    throw gitToolError(
      "GIT_PATHSPEC_BLOCKED",
      `Git 路径参数指向固定排除目录或敏感文件：${text}`
    );
  }
  return text.split(path.sep).join("/");
}

function validateRevision(value, field) {
  const text = String(value ?? "").trim();
  if (!text || !REVISION_PATTERN.test(text) || text.startsWith("-")) {
    throw gitToolError(
      "GIT_REVISION_BLOCKED",
      `${field} 不是允许的 Git revision。`
    );
  }
  return text;
}

function boundedOutput(value, maxChars) {
  const text = String(value ?? "");
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, maxChars)}\n…[truncated by git_diff]`,
    truncated: true
  };
}

function commonArgs(contextLines) {
  return [
    "--no-pager",
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    `--unified=${contextLines}`
  ];
}

async function runGitDiff({
  supervisor,
  cwd,
  args,
  timeoutMs,
  abortSignal
}) {
  return supervisor.run("git", args, {
    cwd,
    timeoutMs,
    abortSignal,
    shell: false,
    env: {
      ...process.env,
      ...SAFE_GIT_ENV
    }
  });
}

const sectionSchema = z.object({
  kind: z.enum(["unstaged", "staged", "range"]),
  ok: z.boolean(),
  exitCode: z.number().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  stdoutBytes: z.number().int().nonnegative(),
  stderrBytes: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  truncated: z.boolean()
});

export function createWorkspaceGitReadToolDefinitions(workspaceSettings = {}) {
  const resolveCwd = (value = ".") => resolveWorkspacePath(value, {
    allowFile: false,
    workspaceSettings
  });

  return [
    {
      name: "git_diff",
      title: "Read Git diff",
      description:
        "Read bounded unstaged, staged, combined, or revision-range Git diffs in the authorized workspace. Arguments are constructed by the host; shell execution, external diff drivers, textconv, output files, unsafe revisions, and escaping pathspecs are blocked.",
      inputSchema: z.object({
        cwd: z.string().trim().max(500).default("."),
        mode: z.enum(["unstaged", "staged", "all", "range"]).default("all"),
        base: z.string().trim().max(200).optional(),
        head: z.string().trim().max(200).optional(),
        paths: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
        contextLines: z.number().int().min(0).max(20).default(3),
        maxOutputChars: z.number().int().min(1_000).max(500_000).default(120_000),
        timeoutMs: z.number().int().min(1_000).max(120_000).default(30_000)
      }).refine((value) => value.mode !== "range" || Boolean(value.base), {
        message: "range 模式必须提供 base。"
      }),
      outputSchema: z.object({
        root: z.string(),
        cwd: z.string(),
        mode: z.enum(["unstaged", "staged", "all", "range"]),
        paths: z.array(z.string()),
        sections: z.array(sectionSchema),
        diff: z.string(),
        empty: z.boolean(),
        truncated: z.boolean(),
        durationMs: z.number().nonnegative()
      }),
      sideEffect: "read",
      riskLevel: "low",
      idempotency: "natural",
      timeoutMs: 120_000,
      retryPolicy: {
        maxAttempts: 1
      },
      runtimeContract: {
        effect: "read",
        retryMode: "safe",
        supportsAbort: true,
        supportsResume: true
      },
      async execute(input, context = {}) {
        const mode = input.mode ?? "all";
        const contextLines = input.contextLines ?? 3;
        const maxOutputChars = input.maxOutputChars ?? 120_000;
        const timeoutMs = input.timeoutMs ?? 30_000;
        const rawPaths = input.paths ?? [];
        if (!context.subprocessSupervisor) {
          throw gitToolError(
            "SUBPROCESS_SUPERVISOR_UNAVAILABLE",
            "受控子进程运行器不可用。"
          );
        }

        const resolved = resolveCwd(input.cwd ?? ".");
        const paths = rawPaths.map((value) => validatePathspec(value, resolved.root));
        const pathArgs = [
          "--",
          ...(paths.length > 0 ? paths : ["."]),
          ...FIXED_EXCLUDE_PATHS
        ];
        const requests = [];

        if (["unstaged", "all"].includes(mode)) {
          requests.push({
            kind: "unstaged",
            args: [...commonArgs(contextLines), ...pathArgs]
          });
        }
        if (["staged", "all"].includes(mode)) {
          requests.push({
            kind: "staged",
            args: [...commonArgs(contextLines), "--cached", ...pathArgs]
          });
        }
        if (mode === "range") {
          const base = validateRevision(input.base, "base");
          const head = input.head ? validateRevision(input.head, "head") : "HEAD";
          requests.push({
            kind: "range",
            args: [...commonArgs(contextLines), `${base}..${head}`, ...pathArgs]
          });
        }

        const startedAt = Date.now();
        const sections = [];
        let remainingChars = maxOutputChars;
        let truncated = false;

        for (const request of requests) {
          const outcome = await runGitDiff({
            supervisor: context.subprocessSupervisor,
            cwd: resolved.path,
            args: request.args,
            timeoutMs,
            abortSignal: context.abortSignal
          });
          if (!outcome.ok) {
            const error = gitToolError(
              outcome.terminationReason === "timeout"
                ? "GIT_DIFF_TIMEOUT"
                : outcome.terminationReason === "abort"
                  ? "CANCELLED_BY_USER"
                  : "GIT_DIFF_FAILED",
              String(outcome.stderr ?? "Git diff 执行失败。").slice(0, 20_000) ||
                "Git diff 执行失败。"
            );
            if (outcome.terminationReason === "abort") error.name = "AbortError";
            throw error;
          }
          const bounded = boundedOutput(outcome.stdout, Math.max(0, remainingChars));
          remainingChars = Math.max(0, remainingChars - bounded.text.length);
          truncated ||= bounded.truncated || outcome.stdoutTruncated === true;

          sections.push({
            kind: request.kind,
            ok: outcome.ok,
            exitCode: outcome.code,
            stdout: bounded.text,
            stderr: String(outcome.stderr ?? "").slice(0, 20_000),
            stdoutBytes: outcome.stdoutBytes ?? Buffer.byteLength(outcome.stdout ?? ""),
            stderrBytes: outcome.stderrBytes ?? Buffer.byteLength(outcome.stderr ?? ""),
            durationMs: outcome.durationMs,
            truncated: bounded.truncated || outcome.stdoutTruncated === true
          });

          if (remainingChars <= 0) {
            truncated = true;
            break;
          }
        }

        const diff = sections.map((section) => {
          if (mode === "all") {
            const title = section.kind === "staged" ? "Staged changes" : "Unstaged changes";
            return `## ${title}\n${section.stdout}`;
          }
          return section.stdout;
        }).filter(Boolean).join("\n\n");

        return {
          root: resolved.root,
          cwd: resolved.relativePath,
          mode,
          paths,
          sections,
          diff,
          empty: sections.every((section) => section.stdout.trim().length === 0),
          truncated,
          durationMs: Date.now() - startedAt
        };
      }
    }
  ];
}
