import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  z
} from "zod";

import {
  getWorkspaceRoots,
  isExcludedDirectory,
  isSensitiveWorkspacePath,
  resolveWorkspacePath
} from "./workspacePolicy.js";

function fileKind(stat) {
  if (stat.isDirectory()) {
    return "directory";
  }

  if (stat.isFile()) {
    return "file";
  }

  if (stat.isSymbolicLink()) {
    return "symlink";
  }

  return "other";
}

function ensureTextFile(
  filePath,
  maxBytes
) {
  const stat =
    fs.statSync(filePath);

  if (stat.size > maxBytes) {
    const error = new Error(
      `文件超过 ${Math.round(maxBytes / 100000) / 10} MB 的只读工具上限。`
    );
    error.code =
      "FILE_TOO_LARGE";
    throw error;
  }

  const buffer =
    fs.readFileSync(filePath);

  if (
    buffer
      .subarray(0, 8192)
      .includes(0)
  ) {
    const error = new Error(
      "检测到二进制文件，拒绝按文本读取。"
    );
    error.code =
      "BINARY_FILE_BLOCKED";
    throw error;
  }

  return buffer.toString("utf8");
}

function globToRegExp(pattern) {
  const source =
    String(pattern ?? "*")
      .trim() || "*";

  let output = "^";

  for (
    let index = 0;
    index < source.length;
    index += 1
  ) {
    const character =
      source[index];

    if (character === "*") {
      if (source[index + 1] === "*") {
        output += ".*";
        index += 1;
      } else {
        output += "[^/\\\\]*";
      }
      continue;
    }

    if (character === "?") {
      output += "[^/\\\\]";
      continue;
    }

    output += character.replace(
      /[.*+?^${}()|[\]\\]/gu,
      "\\$&"
    );
  }

  output += "$";
  return new RegExp(output, "iu");
}

function walkFiles({
  directory,
  root,
  maxDepth,
  onFile,
  signal
}) {
  const stack = [
    {
      directory,
      depth: 0
    }
  ];

  while (stack.length > 0) {
    if (signal?.aborted) {
      const error = new Error(
        "工具执行已取消。"
      );
      error.name = "AbortError";
      throw error;
    }

    const current = stack.pop();

    let entries;

    try {
      entries = fs.readdirSync(
        current.directory,
        {
          withFileTypes: true
        }
      );
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        isExcludedDirectory(
          entry.name
        )
      ) {
        continue;
      }

      const absolutePath =
        path.join(
          current.directory,
          entry.name
        );

      if (
        entry.isSymbolicLink() ||
        isSensitiveWorkspacePath(
          absolutePath
        )
      ) {
        continue;
      }

      if (entry.isDirectory()) {
        if (
          current.depth <
          maxDepth
        ) {
          stack.push({
            directory:
              absolutePath,
            depth:
              current.depth + 1
          });
        }

        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const shouldContinue =
        onFile({
          absolutePath,
          relativePath:
            path.relative(
              root,
              absolutePath
            )
        });

      if (shouldContinue === false) {
        return;
      }
    }
  }
}

function projectType(
  manifestName
) {
  const types = {
    "package.json":
      "Node.js / JavaScript",
    "pyproject.toml":
      "Python",
    "requirements.txt":
      "Python",
    "Cargo.toml":
      "Rust",
    "go.mod": "Go",
    "CMakeLists.txt":
      "C / C++",
    "pom.xml":
      "Java / Maven",
    "build.gradle":
      "Java / Gradle",
    "build.gradle.kts":
      "Kotlin / Gradle"
  };

  return types[manifestName] ??
    "Unknown";
}

export function createWorkspaceToolDefinitions(
  workspaceSettings = {}
) {
  const limits = {
    maxTextFileBytes:
      workspaceSettings.maxTextFileBytes ??
      2_000_000,
    maxReadLines:
      workspaceSettings.maxReadLines ??
      1000,
    maxDirectoryEntries:
      workspaceSettings.maxDirectoryEntries ??
      200,
    maxSearchResults:
      workspaceSettings.maxSearchResults ??
      100,
    maxSearchDepth:
      workspaceSettings.maxSearchDepth ??
      6,
    maxHashFileBytes:
      workspaceSettings.maxHashFileBytes ??
      50_000_000
  };

  const resolve = (
    inputPath,
    options = {}
  ) => resolveWorkspacePath(
    inputPath,
    {
      ...options,
      workspaceSettings
    }
  );

  return [
    {
      name: "list_directory",
      title: "List directory",
      description:
        "List a directory inside an authorized workspace. Hidden credential directories, dependencies, build output, and symlink escapes are excluded.",
      inputSchema: z.object({
        path: z.string()
          .max(500)
          .default("."),
        maxEntries: z.number()
          .int()
          .min(1)
          .max(limits.maxDirectoryEntries)
          .default(limits.maxDirectoryEntries)
      }),
      async execute(input) {
        const resolved =
          resolve(
            input.path,
            {
              allowFile: false
            }
          );

        const entries =
          fs.readdirSync(
            resolved.path,
            {
              withFileTypes: true
            }
          )
            .filter(
              (entry) => {
                if (
                  isExcludedDirectory(
                    entry.name
                  )
                ) {
                  return false;
                }

                const absolutePath =
                  path.join(
                    resolved.path,
                    entry.name
                  );

                return (
                  !entry.isSymbolicLink() &&
                  !isSensitiveWorkspacePath(
                    absolutePath
                  )
                );
              }
            )
            .slice(0, input.maxEntries)
            .map((entry) => {
              const absolutePath =
                path.join(
                  resolved.path,
                  entry.name
                );
              const stat =
                fs.lstatSync(
                  absolutePath
                );

              return {
                name: entry.name,
                type: fileKind(stat),
                sizeBytes:
                  stat.isFile()
                    ? stat.size
                    : null,
                modifiedAt:
                  stat.mtime.toISOString()
              };
            });

        return {
          root: resolved.root,
          path:
            resolved.relativePath,
          entries,
          truncated:
            entries.length >=
            input.maxEntries
        };
      }
    },
    {
      name: "stat_path",
      title: "Inspect path",
      description:
        "Get safe metadata for a file or directory inside the authorized workspace without reading its content.",
      inputSchema: z.object({
        path: z.string()
          .min(1)
          .max(500)
      }),
      async execute({
        path: inputPath
      }) {
        const resolved =
          resolve(
            inputPath
          );
        const stat =
          fs.statSync(
            resolved.path
          );

        return {
          root: resolved.root,
          path:
            resolved.relativePath,
          type: fileKind(stat),
          sizeBytes:
            stat.isFile()
              ? stat.size
              : null,
          createdAt:
            stat.birthtime
              .toISOString(),
          modifiedAt:
            stat.mtime
              .toISOString(),
          readable: true,
          writableByTool: false
        };
      }
    },
    {
      name: "read_text_file",
      title: "Read text file",
      description:
        "Read a limited line range from a text file inside the authorized workspace. Sensitive and binary files are blocked.",
      inputSchema: z.object({
        path: z.string()
          .min(1)
          .max(500),
        startLine: z.number()
          .int()
          .min(1)
          .default(1),
        endLine: z.number()
          .int()
          .min(1)
          .max(limits.maxReadLines + 1)
          .optional()
      }),
      async execute(input) {
        const resolved =
          resolve(
            input.path,
            {
              allowDirectory: false
            }
          );
        const text =
          ensureTextFile(
            resolved.path,
            limits.maxTextFileBytes
          );
        const lines =
          text.split(/\r?\n/u);
        const start =
          input.startLine;
        const requestedEnd =
          input.endLine ??
          start + 199;
        const end =
          Math.min(
            requestedEnd,
            start +
            limits.maxReadLines - 1,
            lines.length
          );

        return {
          root: resolved.root,
          path:
            resolved.relativePath,
          startLine: start,
          endLine: end,
          totalLines:
            lines.length,
          content:
            lines
              .slice(
                start - 1,
                end
              )
              .join("\n"),
          truncated:
            end < lines.length
        };
      }
    },
    {
      name: "search_files",
      title: "Search files",
      description:
        "Search file paths in the authorized workspace using a simple glob pattern. Does not follow symlinks or inspect excluded directories.",
      inputSchema: z.object({
        path: z.string()
          .max(500)
          .default("."),
        pattern: z.string()
          .min(1)
          .max(200),
        maxDepth: z.number()
          .int()
          .min(0)
          .max(limits.maxSearchDepth)
          .default(limits.maxSearchDepth),
        maxResults: z.number()
          .int()
          .min(1)
          .max(limits.maxSearchResults)
          .default(limits.maxSearchResults)
      }),
      async execute(
        input,
        context
      ) {
        const resolved =
          resolve(
            input.path,
            {
              allowFile: false
            }
          );
        const matcher =
          globToRegExp(
            input.pattern
          );
        const matches = [];

        walkFiles({
          directory:
            resolved.path,
          root: resolved.root,
          maxDepth:
            input.maxDepth,
          signal:
            context.abortSignal,
          onFile({
            relativePath
          }) {
            const normalized =
              relativePath
                .split(path.sep)
                .join("/");

            if (
              matcher.test(normalized) ||
              matcher.test(
                path.basename(
                  normalized
                )
              )
            ) {
              matches.push(
                normalized
              );
            }

            return (
              matches.length <
              input.maxResults
            );
          }
        });

        return {
          root: resolved.root,
          pattern:
            input.pattern,
          matches,
          truncated:
            matches.length >=
            input.maxResults
        };
      }
    },
    {
      name: "search_text",
      title: "Search text",
      description:
        "Search for a literal text string in safe text files inside the authorized workspace. The query is not treated as a regular expression.",
      inputSchema: z.object({
        path: z.string()
          .max(500)
          .default("."),
        query: z.string()
          .min(1)
          .max(500),
        caseSensitive: z.boolean()
          .default(false),
        extensions: z.array(
          z.string()
            .min(1)
            .max(20)
        ).max(30)
          .optional(),
        maxDepth: z.number()
          .int()
          .min(0)
          .max(limits.maxSearchDepth)
          .default(limits.maxSearchDepth),
        maxResults: z.number()
          .int()
          .min(1)
          .max(limits.maxSearchResults)
          .default(limits.maxSearchResults)
      }),
      async execute(
        input,
        context
      ) {
        const resolved =
          resolve(
            input.path,
            {
              allowFile: false
            }
          );
        const query =
          input.caseSensitive
            ? input.query
            : input.query
                .toLowerCase();
        const extensions =
          input.extensions
            ?.map(
              (extension) =>
                extension
                  .toLowerCase()
                  .replace(/^\./u, "")
            );
        const matches = [];

        walkFiles({
          directory:
            resolved.path,
          root: resolved.root,
          maxDepth:
            input.maxDepth,
          signal:
            context.abortSignal,
          onFile({
            absolutePath,
            relativePath
          }) {
            if (
              extensions?.length
            ) {
              const extension =
                path.extname(
                  absolutePath
                )
                  .toLowerCase()
                  .replace(/^\./u, "");

              if (
                !extensions.includes(
                  extension
                )
              ) {
                return true;
              }
            }

            let text;

            try {
              text =
                ensureTextFile(
                  absolutePath,
                  limits.maxTextFileBytes
                );
            } catch {
              return true;
            }

            const lines =
              text.split(/\r?\n/u);

            for (
              let index = 0;
              index < lines.length;
              index += 1
            ) {
              const comparable =
                input.caseSensitive
                  ? lines[index]
                  : lines[index]
                      .toLowerCase();

              if (
                comparable.includes(
                  query
                )
              ) {
                matches.push({
                  path:
                    relativePath
                      .split(path.sep)
                      .join("/"),
                  line:
                    index + 1,
                  text:
                    lines[index]
                      .slice(0, 500)
                });
              }

              if (
                matches.length >=
                input.maxResults
              ) {
                return false;
              }
            }

            return true;
          }
        });

        return {
          root: resolved.root,
          query:
            input.query,
          matches,
          truncated:
            matches.length >=
            input.maxResults
        };
      }
    },
    {
      name: "detect_project",
      title: "Detect project",
      description:
        "Identify common project manifests and package scripts in an authorized workspace without executing commands.",
      inputSchema: z.object({
        path: z.string()
          .max(500)
          .default(".")
      }),
      async execute(input) {
        const resolved =
          resolve(
            input.path,
            {
              allowFile: false
            }
          );
        const manifests = [
          "package.json",
          "pyproject.toml",
          "requirements.txt",
          "Cargo.toml",
          "go.mod",
          "CMakeLists.txt",
          "pom.xml",
          "build.gradle",
          "build.gradle.kts"
        ]
          .filter(
            (name) =>
              fs.existsSync(
                path.join(
                  resolved.path,
                  name
                )
              )
          )
          .map(
            (name) => ({
              name,
              type:
                projectType(name)
            })
          );

        let packageSummary = null;
        const packagePath =
          path.join(
            resolved.path,
            "package.json"
          );

        if (fs.existsSync(packagePath)) {
          try {
            const data = JSON.parse(
              ensureTextFile(
                packagePath,
                limits.maxTextFileBytes
              )
            );

            packageSummary = {
              name:
                data.name ?? null,
              version:
                data.version ?? null,
              private:
                Boolean(data.private),
              scripts:
                Object.keys(
                  data.scripts ?? {}
                ).slice(0, 50),
              packageManager:
                data.packageManager ??
                null
            };
          } catch {
            packageSummary = {
              error:
                "package.json 无法解析。"
            };
          }
        }

        return {
          root: resolved.root,
          path:
            resolved.relativePath,
          manifests,
          package:
            packageSummary
        };
      }
    },
    {
      name: "compute_file_hash",
      title: "Compute file hash",
      description:
        "Compute a SHA-256 hash for a safe file inside the authorized workspace without changing it.",
      inputSchema: z.object({
        path: z.string()
          .min(1)
          .max(500)
      }),
      async execute(input) {
        const resolved =
          resolve(
            input.path,
            {
              allowDirectory: false
            }
          );
        const stat =
          fs.statSync(
            resolved.path
          );

        if (
          stat.size >
          limits.maxHashFileBytes
        ) {
          const error = new Error(
            `文件超过 ${Math.round(limits.maxHashFileBytes / 100000) / 10} MB 的哈希计算上限。`
          );
          error.code =
            "FILE_TOO_LARGE";
          throw error;
        }

        const hash =
          crypto
            .createHash("sha256")
            .update(
              fs.readFileSync(
                resolved.path
              )
            )
            .digest("hex");

        return {
          root: resolved.root,
          path:
            resolved.relativePath,
          algorithm: "sha256",
          hash,
          sizeBytes:
            stat.size
        };
      }
    }
  ];
}

export function getDefaultWorkspaceRoot(
  workspaceSettings = {}
) {
  return getWorkspaceRoots(
    workspaceSettings
  )[0] ?? null;
}
