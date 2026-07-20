import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import {
  getWorkspaceRoots,
  isExcludedDirectory,
  isSensitiveWorkspacePath,
  resolveWorkspacePath
} from "./workspacePolicy.js";

const fsp = fs.promises;
const READ_RUNTIME_CONTRACT = Object.freeze({
  effect: "read",
  retryMode: "safe",
  supportsAbort: true,
  supportsResume: true
});

function workspaceToolError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) {
    return;
  }
  const error = workspaceToolError("CANCELLED_BY_USER", "工具执行已取消。");
  error.name = "AbortError";
  throw error;
}

function fileKind(stat) {
  if (stat.isDirectory()) return "directory";
  if (stat.isFile()) return "file";
  if (stat.isSymbolicLink()) return "symlink";
  return "other";
}

function sizeLimitMessage(maxBytes) {
  return `${Math.round(maxBytes / 100_000) / 10} MB`;
}

async function openSafeReadHandle(filePath) {
  const flags = process.platform === "win32"
    ? "r"
    : fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW;
  try {
    return await fsp.open(filePath, flags);
  } catch (error) {
    if (["ELOOP", "EMLINK"].includes(error?.code)) {
      throw workspaceToolError(
        "SYMLINK_READ_BLOCKED",
        "拒绝读取符号链接文件。"
      );
    }
    throw error;
  }
}

function assertStableFile(before, after, bytesRead) {
  if (
    after.size !== before.size ||
    after.size !== bytesRead ||
    after.mtimeMs !== before.mtimeMs
  ) {
    throw workspaceToolError(
      "FILE_CHANGED_DURING_READ",
      "文件在读取期间发生变化，请重试。"
    );
  }
}

async function readSafeTextFile(filePath, maxBytes, { signal } = {}) {
  throwIfAborted(signal);
  const handle = await openSafeReadHandle(filePath);

  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw workspaceToolError("FILE_REQUIRED", "该工具只接受普通文件。");
    }
    if (stat.size > maxBytes) {
      throw workspaceToolError(
        "FILE_TOO_LARGE",
        `文件超过 ${sizeLimitMessage(maxBytes)} 的只读工具上限。`
      );
    }

    const chunks = [];
    let totalBytes = 0;
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1));

    while (true) {
      throwIfAborted(signal);
      const { bytesRead } = await handle.read(
        buffer,
        0,
        buffer.length,
        null
      );
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > maxBytes) {
        throw workspaceToolError(
          "FILE_TOO_LARGE",
          `文件读取期间增长并超过 ${sizeLimitMessage(maxBytes)} 上限。`
        );
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }

    const after = await handle.stat();
    assertStableFile(stat, after, totalBytes);
    const content = Buffer.concat(chunks, totalBytes);
    if (content.subarray(0, 8192).includes(0)) {
      throw workspaceToolError(
        "BINARY_FILE_BLOCKED",
        "检测到二进制文件，拒绝按文本读取。"
      );
    }

    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      throw workspaceToolError(
        "INVALID_TEXT_ENCODING",
        "文件不是有效的 UTF-8 文本。"
      );
    }

    return {
      text,
      bytes: totalBytes,
      stat: after
    };
  } finally {
    await handle.close();
  }
}

function escapeRegExp(character) {
  return /[.*+?^${}()|[\]\\]/u.test(character)
    ? `\\${character}`
    : character;
}

function globToRegExp(pattern) {
  const source = String(pattern ?? "*").trim() || "*";
  let output = "^";

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "*") {
      if (source[index + 1] === "*") {
        if (["/", "\\"].includes(source[index + 2])) {
          output += "(?:.*[/\\\\])?";
          index += 2;
        } else {
          output += ".*";
          index += 1;
        }
      } else {
        output += "[^/\\\\]*";
      }
    } else if (character === "?") {
      output += "[^/\\\\]";
    } else if (["/", "\\"].includes(character)) {
      output += "[/\\\\]";
    } else {
      output += escapeRegExp(character);
    }
  }

  return new RegExp(`${output}$`, "iu");
}

async function walkFiles({
  directory,
  root,
  maxDepth,
  maxFiles,
  maxEntries,
  onFile,
  signal
}) {
  const stack = [{ directory, depth: 0 }];
  const stats = {
    directoriesVisited: 0,
    filesVisited: 0,
    entriesVisited: 0,
    skippedDirectories: 0,
    skippedEntries: 0,
    stopped: false,
    limitReason: ""
  };

  while (stack.length > 0) {
    throwIfAborted(signal);
    const current = stack.pop();
    let entries;

    try {
      entries = await fsp.readdir(current.directory, { withFileTypes: true });
      stats.directoriesVisited += 1;
    } catch {
      stats.skippedDirectories += 1;
      continue;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    const childDirectories = [];

    for (const entry of entries) {
      throwIfAborted(signal);
      stats.entriesVisited += 1;
      if (stats.entriesVisited > maxEntries) {
        stats.stopped = true;
        stats.limitReason = "entry_limit";
        return stats;
      }

      if (entry.isDirectory() && isExcludedDirectory(entry.name)) {
        stats.skippedEntries += 1;
        continue;
      }

      const absolutePath = path.join(current.directory, entry.name);
      if (entry.isSymbolicLink() || isSensitiveWorkspacePath(absolutePath)) {
        stats.skippedEntries += 1;
        continue;
      }

      if (entry.isDirectory()) {
        if (current.depth < maxDepth) {
          childDirectories.push({
            directory: absolutePath,
            depth: current.depth + 1
          });
        }
        continue;
      }

      if (!entry.isFile()) {
        stats.skippedEntries += 1;
        continue;
      }

      stats.filesVisited += 1;
      if (stats.filesVisited > maxFiles) {
        stats.stopped = true;
        stats.limitReason = "file_limit";
        return stats;
      }

      const shouldContinue = await onFile({
        absolutePath,
        relativePath: path.relative(root, absolutePath)
      });
      if (shouldContinue === false) {
        stats.stopped = true;
        if (!stats.limitReason) stats.limitReason = "result_limit";
        return stats;
      }
    }

    for (let index = childDirectories.length - 1; index >= 0; index -= 1) {
      stack.push(childDirectories[index]);
    }
  }

  return stats;
}

function projectType(manifestName) {
  const types = {
    "package.json": "Node.js / JavaScript",
    "pyproject.toml": "Python",
    "requirements.txt": "Python",
    "Cargo.toml": "Rust",
    "go.mod": "Go",
    "CMakeLists.txt": "C / C++",
    "pom.xml": "Java / Maven",
    "build.gradle": "Java / Gradle",
    "build.gradle.kts": "Kotlin / Gradle"
  };
  return types[manifestName] ?? "Unknown";
}

function normalizedPath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

async function hashFile(filePath, maxBytes, { signal } = {}) {
  throwIfAborted(signal);
  const handle = await openSafeReadHandle(filePath);

  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw workspaceToolError("FILE_REQUIRED", "该工具只接受普通文件。");
    }
    if (stat.size > maxBytes) {
      throw workspaceToolError(
        "FILE_TOO_LARGE",
        `文件超过 ${sizeLimitMessage(maxBytes)} 的哈希计算上限。`
      );
    }

    const hash = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(128 * 1024);
    let totalBytes = 0;

    while (true) {
      throwIfAborted(signal);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > maxBytes) {
        throw workspaceToolError(
          "FILE_TOO_LARGE",
          "文件读取期间增长并超过哈希计算上限。"
        );
      }
      hash.update(buffer.subarray(0, bytesRead));
    }

    const after = await handle.stat();
    assertStableFile(stat, after, totalBytes);
    return {
      hash: hash.digest("hex"),
      sizeBytes: totalBytes,
      modifiedAt: after.mtime.toISOString()
    };
  } finally {
    await handle.close();
  }
}

const pathSchema = z.string().trim().max(500);
const runtimeReadMetadata = {
  sideEffect: "read",
  riskLevel: "low",
  idempotency: "natural",
  retryPolicy: {
    maxAttempts: 2,
    retryOn: ["TEMPORARY_FAILURE"],
    backoffMs: 120
  },
  runtimeContract: READ_RUNTIME_CONTRACT
};

export function createWorkspaceToolDefinitions(workspaceSettings = {}) {
  const limits = {
    maxTextFileBytes: Math.min(
      20_000_000,
      Math.max(
        1_024,
        Number(workspaceSettings.maxTextFileBytes) || 2_000_000
      )
    ),
    maxReadLines: Math.min(
      5_000,
      Math.max(
        1,
        Number(workspaceSettings.maxReadLines) || 1000
      )
    ),
    maxDirectoryEntries: Math.min(
      1_000,
      Math.max(
        1,
        Number(workspaceSettings.maxDirectoryEntries) || 200
      )
    ),
    maxSearchResults: Math.min(
      500,
      Math.max(
        1,
        Number(workspaceSettings.maxSearchResults) || 100
      )
    ),
    maxSearchDepth: Math.min(
      12,
      Math.max(
        0,
        Number(workspaceSettings.maxSearchDepth) || 6
      )
    ),
    maxHashFileBytes: Math.min(
      200_000_000,
      Math.max(
        1_024,
        Number(workspaceSettings.maxHashFileBytes) || 50_000_000
      )
    )
  };
  limits.maxSearchFiles = Math.min(
    20_000,
    Math.max(500, limits.maxSearchResults * 100)
  );
  limits.maxSearchEntries = Math.min(
    100_000,
    Math.max(2_000, limits.maxSearchFiles * 5)
  );
  limits.maxSearchBytes = Math.min(
    256_000_000,
    Math.max(10_000_000, limits.maxTextFileBytes * 50)
  );

  const resolve = (inputPath, options = {}) => resolveWorkspacePath(inputPath, {
    ...options,
    workspaceSettings
  });

  return [
    {
      name: "list_directory",
      title: "List directory",
      description:
        "List one authorized workspace directory in deterministic name order. Excluded, sensitive, unreadable, and symlink entries are omitted; truncation is reported accurately.",
      inputSchema: z.object({
        path: pathSchema.default("."),
        maxEntries: z.number().int().min(1)
          .max(limits.maxDirectoryEntries)
          .default(limits.maxDirectoryEntries)
      }),
      outputSchema: z.object({
        root: z.string(),
        path: z.string(),
        entries: z.array(z.object({
          name: z.string(),
          type: z.enum(["directory", "file", "symlink", "other"]),
          sizeBytes: z.number().int().nullable(),
          modifiedAt: z.string()
        })),
        truncated: z.boolean(),
        skippedEntries: z.number().int()
      }),
      timeoutMs: 15_000,
      ...runtimeReadMetadata,
      async execute(input, context = {}) {
        throwIfAborted(context.abortSignal);
        const resolved = resolve(input.path, { allowFile: false });
        const rawEntries = await fsp.readdir(resolved.path, {
          withFileTypes: true
        });
        rawEntries.sort((left, right) => left.name.localeCompare(right.name, "en"));

        const visible = [];
        let skippedEntries = 0;
        for (const entry of rawEntries) {
          throwIfAborted(context.abortSignal);
          const absolutePath = path.join(resolved.path, entry.name);
          if (
            isExcludedDirectory(entry.name) ||
            entry.isSymbolicLink() ||
            isSensitiveWorkspacePath(absolutePath)
          ) {
            skippedEntries += 1;
            continue;
          }

          try {
            const stat = await fsp.lstat(absolutePath);
            visible.push({
              name: entry.name,
              type: fileKind(stat),
              sizeBytes: stat.isFile() ? stat.size : null,
              modifiedAt: stat.mtime.toISOString()
            });
          } catch {
            skippedEntries += 1;
          }

          if (visible.length > input.maxEntries) break;
        }

        return {
          root: resolved.root,
          path: resolved.relativePath,
          entries: visible.slice(0, input.maxEntries),
          truncated: visible.length > input.maxEntries,
          skippedEntries
        };
      }
    },
    {
      name: "stat_path",
      title: "Inspect path",
      description:
        "Get stable metadata for one safe file or directory inside an authorized workspace without reading its content.",
      inputSchema: z.object({
        path: pathSchema.min(1)
      }),
      outputSchema: z.object({
        root: z.string(),
        path: z.string(),
        type: z.enum(["directory", "file", "symlink", "other"]),
        sizeBytes: z.number().int().nullable(),
        createdAt: z.string(),
        modifiedAt: z.string(),
        readable: z.boolean(),
        writableByTool: z.boolean()
      }),
      timeoutMs: 10_000,
      ...runtimeReadMetadata,
      async execute({ path: inputPath }, context = {}) {
        throwIfAborted(context.abortSignal);
        const resolved = resolve(inputPath);
        const stat = await fsp.stat(resolved.path);
        return {
          root: resolved.root,
          path: resolved.relativePath,
          type: fileKind(stat),
          sizeBytes: stat.isFile() ? stat.size : null,
          createdAt: stat.birthtime.toISOString(),
          modifiedAt: stat.mtime.toISOString(),
          readable: true,
          writableByTool: false
        };
      }
    },
    {
      name: "read_text_file",
      title: "Read text file",
      description:
        "Read a bounded line range from one safe UTF-8 text file. startLine and endLine are absolute 1-based line numbers; ranges may begin anywhere in the file and the runtime caps the number of returned lines.",
      inputSchema: z.object({
        path: pathSchema.min(1),
        startLine: z.number().int().min(1).default(1),
        endLine: z.number().int().min(1).max(10_000_000).optional()
      }),
      outputSchema: z.object({
        root: z.string(),
        path: z.string(),
        startLine: z.number().int(),
        endLine: z.number().int(),
        totalLines: z.number().int(),
        content: z.string(),
        truncated: z.boolean(),
        hasMoreBefore: z.boolean(),
        hasMoreAfter: z.boolean(),
        nextStartLine: z.number().int().nullable(),
        sizeBytes: z.number().int()
      }),
      timeoutMs: 20_000,
      ...runtimeReadMetadata,
      async execute(input, context = {}) {
        const resolved = resolve(input.path, { allowDirectory: false });
        const file = await readSafeTextFile(
          resolved.path,
          limits.maxTextFileBytes,
          { signal: context.abortSignal }
        );
        const lines = file.text.split(/\r?\n/u);
        const start = input.startLine;

        if (start > lines.length) {
          throw workspaceToolError(
            "LINE_RANGE_OUT_OF_BOUNDS",
            `起始行 ${start} 超出文件总行数 ${lines.length}。`
          );
        }

        const requestedEnd = input.endLine ?? start + Math.min(199, limits.maxReadLines - 1);
        if (requestedEnd < start) {
          throw workspaceToolError(
            "INVALID_LINE_RANGE",
            "endLine 不能小于 startLine。"
          );
        }

        const end = Math.min(
          requestedEnd,
          start + limits.maxReadLines - 1,
          lines.length
        );
        const hasMoreAfter = end < lines.length;

        return {
          root: resolved.root,
          path: resolved.relativePath,
          startLine: start,
          endLine: end,
          totalLines: lines.length,
          content: lines.slice(start - 1, end).join("\n"),
          truncated: hasMoreAfter || requestedEnd > end,
          hasMoreBefore: start > 1,
          hasMoreAfter,
          nextStartLine: hasMoreAfter ? end + 1 : null,
          sizeBytes: file.bytes
        };
      }
    },
    {
      name: "search_files",
      title: "Search files",
      description:
        "Search safe file paths with a bounded simple Glob. Results and traversal are deterministic; **/ may match zero or more directories. Scan limits and truncation are reported.",
      inputSchema: z.object({
        path: pathSchema.default("."),
        pattern: z.string().trim().min(1).max(200),
        maxDepth: z.number().int().min(0)
          .max(limits.maxSearchDepth)
          .default(limits.maxSearchDepth),
        maxResults: z.number().int().min(1)
          .max(limits.maxSearchResults)
          .default(limits.maxSearchResults)
      }),
      outputSchema: z.object({
        root: z.string(),
        pattern: z.string(),
        matches: z.array(z.string()),
        truncated: z.boolean(),
        limitReason: z.string(),
        scannedFiles: z.number().int(),
        scannedDirectories: z.number().int(),
        skippedEntries: z.number().int()
      }),
      timeoutMs: 60_000,
      ...runtimeReadMetadata,
      async execute(input, context = {}) {
        const resolved = resolve(input.path, { allowFile: false });
        const matcher = globToRegExp(input.pattern);
        const matches = [];
        const traversal = await walkFiles({
          directory: resolved.path,
          root: resolved.root,
          maxDepth: input.maxDepth,
          maxFiles: limits.maxSearchFiles,
          maxEntries: limits.maxSearchEntries,
          signal: context.abortSignal,
          async onFile({ relativePath }) {
            const normalized = normalizedPath(relativePath);
            if (matcher.test(normalized) || matcher.test(path.basename(normalized))) {
              matches.push(normalized);
            }
            return matches.length <= input.maxResults;
          }
        });

        const truncated = matches.length > input.maxResults ||
          ["file_limit", "entry_limit"].includes(traversal.limitReason);
        return {
          root: resolved.root,
          pattern: input.pattern,
          matches: matches.slice(0, input.maxResults),
          truncated,
          limitReason: matches.length > input.maxResults
            ? "result_limit"
            : traversal.limitReason,
          scannedFiles: traversal.filesVisited,
          scannedDirectories: traversal.directoriesVisited,
          skippedEntries: traversal.skippedEntries + traversal.skippedDirectories
        };
      }
    },
    {
      name: "search_text",
      title: "Search text",
      description:
        "Search a literal text string in safe UTF-8 files. The query is never a regular expression. File-count, byte, depth, and result limits prevent unbounded workspace scans.",
      inputSchema: z.object({
        path: pathSchema.default("."),
        query: z.string().min(1).max(500),
        caseSensitive: z.boolean().default(false),
        extensions: z.array(
          z.string().trim().min(1).max(20).regex(/^\.?[a-z0-9_+.-]+$/iu)
        ).max(30).optional(),
        maxDepth: z.number().int().min(0)
          .max(limits.maxSearchDepth)
          .default(limits.maxSearchDepth),
        maxResults: z.number().int().min(1)
          .max(limits.maxSearchResults)
          .default(limits.maxSearchResults)
      }),
      outputSchema: z.object({
        root: z.string(),
        query: z.string(),
        matches: z.array(z.object({
          path: z.string(),
          line: z.number().int(),
          text: z.string()
        })),
        truncated: z.boolean(),
        limitReason: z.string(),
        scannedFiles: z.number().int(),
        scannedBytes: z.number().int(),
        skippedFiles: z.number().int()
      }),
      timeoutMs: 90_000,
      ...runtimeReadMetadata,
      async execute(input, context = {}) {
        const resolved = resolve(input.path, { allowFile: false });
        const query = input.caseSensitive ? input.query : input.query.toLowerCase();
        const extensions = input.extensions?.length
          ? new Set(input.extensions.map((extension) =>
              extension.toLowerCase().replace(/^\./u, "")
            ))
          : null;
        const matches = [];
        let scannedBytes = 0;
        let scannedFiles = 0;
        let skippedFiles = 0;
        let byteLimitReached = false;

        const traversal = await walkFiles({
          directory: resolved.path,
          root: resolved.root,
          maxDepth: input.maxDepth,
          maxFiles: limits.maxSearchFiles,
          maxEntries: limits.maxSearchEntries,
          signal: context.abortSignal,
          async onFile({ absolutePath, relativePath }) {
            if (extensions) {
              const extension = path.extname(absolutePath)
                .toLowerCase()
                .replace(/^\./u, "");
              if (!extensions.has(extension)) return true;
            }

            let file;
            try {
              file = await readSafeTextFile(
                absolutePath,
                limits.maxTextFileBytes,
                { signal: context.abortSignal }
              );
            } catch (error) {
              if (error?.name === "AbortError") throw error;
              skippedFiles += 1;
              return true;
            }

            if (scannedBytes + file.bytes > limits.maxSearchBytes) {
              byteLimitReached = true;
              return false;
            }
            scannedBytes += file.bytes;
            scannedFiles += 1;

            const lines = file.text.split(/\r?\n/u);
            for (let index = 0; index < lines.length; index += 1) {
              throwIfAborted(context.abortSignal);
              const comparable = input.caseSensitive
                ? lines[index]
                : lines[index].toLowerCase();
              if (comparable.includes(query)) {
                matches.push({
                  path: normalizedPath(relativePath),
                  line: index + 1,
                  text: lines[index].slice(0, 500)
                });
              }
              if (matches.length > input.maxResults) return false;
            }
            return true;
          }
        });

        const limitReason = byteLimitReached
          ? "byte_limit"
          : matches.length > input.maxResults
            ? "result_limit"
            : traversal.limitReason;
        return {
          root: resolved.root,
          query: input.query,
          matches: matches.slice(0, input.maxResults),
          truncated: Boolean(limitReason),
          limitReason,
          scannedFiles,
          scannedBytes,
          skippedFiles: skippedFiles + traversal.skippedDirectories
        };
      }
    },
    {
      name: "detect_project",
      title: "Detect project",
      description:
        "Identify common project manifests, lockfiles, package manager, and package scripts without executing code. Symlinked or excluded manifests are ignored.",
      inputSchema: z.object({
        path: pathSchema.default(".")
      }),
      outputSchema: z.object({
        root: z.string(),
        path: z.string(),
        manifests: z.array(z.object({ name: z.string(), type: z.string() })),
        lockfiles: z.array(z.string()),
        package: z.object({
          name: z.string().nullable(),
          version: z.string().nullable(),
          private: z.boolean(),
          scripts: z.array(z.string()),
          packageManager: z.string().nullable()
        }).or(z.object({
          error: z.string(),
          errorCode: z.string()
        })).nullable()
      }),
      timeoutMs: 20_000,
      ...runtimeReadMetadata,
      async execute(input, context = {}) {
        throwIfAborted(context.abortSignal);
        const resolved = resolve(input.path, { allowFile: false });
        const manifestNames = [
          "package.json",
          "pyproject.toml",
          "requirements.txt",
          "Cargo.toml",
          "go.mod",
          "CMakeLists.txt",
          "pom.xml",
          "build.gradle",
          "build.gradle.kts"
        ];
        const lockfileNames = [
          "pnpm-lock.yaml",
          "yarn.lock",
          "package-lock.json",
          "bun.lock",
          "bun.lockb",
          "poetry.lock",
          "uv.lock",
          "Cargo.lock",
          "go.sum"
        ];

        const safeFiles = new Map();
        for (const name of [...manifestNames, ...lockfileNames]) {
          throwIfAborted(context.abortSignal);
          try {
            const candidate = resolve(path.join(resolved.path, name), {
              allowDirectory: false
            });
            const stat = await fsp.lstat(candidate.path);
            if (stat.isFile() && !stat.isSymbolicLink()) {
              safeFiles.set(name, candidate.path);
            }
          } catch {
            // Missing, excluded, sensitive, unreadable, and symlinked manifests are omitted.
          }
        }

        const manifests = manifestNames
          .filter((name) => safeFiles.has(name))
          .map((name) => ({ name, type: projectType(name) }));
        const lockfiles = lockfileNames.filter((name) => safeFiles.has(name));

        let packageSummary = null;
        const packagePath = safeFiles.get("package.json");
        if (packagePath) {
          try {
            const file = await readSafeTextFile(
              packagePath,
              limits.maxTextFileBytes,
              { signal: context.abortSignal }
            );
            const data = JSON.parse(file.text);
            const inferredPackageManager = data.packageManager ?? (
              lockfiles.includes("pnpm-lock.yaml") ? "pnpm" :
              lockfiles.includes("yarn.lock") ? "yarn" :
              lockfiles.includes("package-lock.json") ? "npm" :
              lockfiles.some((name) => name.startsWith("bun.lock")) ? "bun" :
              null
            );
            packageSummary = {
              name: typeof data.name === "string" ? data.name : null,
              version: typeof data.version === "string" ? data.version : null,
              private: Boolean(data.private),
              scripts: Object.keys(data.scripts ?? {}).sort().slice(0, 50),
              packageManager: inferredPackageManager
            };
          } catch (error) {
            if (error?.name === "AbortError") throw error;
            packageSummary = {
              error: "package.json 无法安全读取或解析。",
              errorCode: String(error?.code ?? "INVALID_PACKAGE_JSON")
            };
          }
        }

        return {
          root: resolved.root,
          path: resolved.relativePath,
          manifests,
          lockfiles,
          package: packageSummary
        };
      }
    },
    {
      name: "compute_file_hash",
      title: "Compute file hash",
      description:
        "Stream a safe file and compute SHA-256 without loading the whole file into memory. The operation supports cancellation and enforces a byte limit even if the file grows during reading.",
      inputSchema: z.object({
        path: pathSchema.min(1)
      }),
      outputSchema: z.object({
        root: z.string(),
        path: z.string(),
        algorithm: z.literal("sha256"),
        hash: z.string().regex(/^[a-f0-9]{64}$/u),
        sizeBytes: z.number().int(),
        modifiedAt: z.string()
      }),
      timeoutMs: 90_000,
      ...runtimeReadMetadata,
      async execute(input, context = {}) {
        const resolved = resolve(input.path, { allowDirectory: false });
        const result = await hashFile(
          resolved.path,
          limits.maxHashFileBytes,
          { signal: context.abortSignal }
        );
        return {
          root: resolved.root,
          path: resolved.relativePath,
          algorithm: "sha256",
          ...result
        };
      }
    }
  ];
}

export function getDefaultWorkspaceRoot(workspaceSettings = {}) {
  return getWorkspaceRoots(workspaceSettings)[0] ?? null;
}
