import fs from "node:fs";
import path from "node:path";

const EXCLUDED_DIRECTORIES =
  new Set([
    ".git",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".cache",
    ".next",
    ".vite",
    "test-results",
    "playwright-report"
  ]);

const SENSITIVE_FILE_PATTERNS = [
  /^\.env(?:\..*)?$/iu,
  /^\.npmrc$/iu,
  /^\.pypirc$/iu,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/iu,
  /\.(?:pem|key|p12|pfx)$/iu,
  /^(?:credentials|secrets?)(?:\.[^.]+)?$/iu,
  /^git-credentials$/iu
];

const SENSITIVE_DIRECTORY_NAMES =
  new Set([
    ".aws",
    ".azure",
    ".kube",
    ".ssh"
  ]);

function unique(values) {
  return [...new Set(values)];
}

function configuredRoots(
  workspaceSettings = {}
) {
  if (
    workspaceSettings.enabled === false
  ) {
    return [];
  }

  return unique(
    (Array.isArray(
      workspaceSettings.roots
    )
      ? workspaceSettings.roots
      : [])
      .map((value) =>
        String(value ?? "").trim()
      )
      .filter(Boolean)
      .map((value) =>
        path.resolve(value)
      )
  );
}

function isWithinRoot(
  candidate,
  root
) {
  const relative =
    path.relative(
      root,
      candidate
    );

  return (
    relative === "" ||
    (
      !relative.startsWith("..") &&
      !path.isAbsolute(relative)
    )
  );
}

function hasSensitiveSegment(
  candidate
) {
  const parts =
    path.normalize(candidate)
      .split(path.sep)
      .filter(Boolean);

  return parts.some(
    (part) =>
      SENSITIVE_DIRECTORY_NAMES
        .has(part.toLowerCase())
  );
}

function isSensitiveFile(
  candidate
) {
  const basename =
    path.basename(candidate);

  return SENSITIVE_FILE_PATTERNS
    .some(
      (pattern) =>
        pattern.test(basename)
    );
}

export function getWorkspaceRoots(
  workspaceSettings = {}
) {
  return configuredRoots(
    workspaceSettings
  );
}

export function getWorkspacePolicySummary(
  workspaceSettings = {}
) {
  const roots = getWorkspaceRoots(
    workspaceSettings
  );

  if (roots.length === 0) {
    return null;
  }

  return {
    enabled: true,
    roots,
    mode: "read-only",
    excludes: [
      ...EXCLUDED_DIRECTORIES
    ].sort(),
    sensitiveFilesBlocked: true,
    symlinkEscapeBlocked: true
  };
}

export function isSensitiveWorkspacePath(
  candidate
) {
  return (
    hasSensitiveSegment(candidate) ||
    isSensitiveFile(candidate)
  );
}

export function isExcludedDirectory(
  name
) {
  return EXCLUDED_DIRECTORIES
    .has(
      String(name ?? "")
        .toLowerCase()
    );
}

export function resolveWorkspacePath(
  inputPath = ".",
  {
    mustExist = true,
    allowDirectory = true,
    allowFile = true,
    workspaceSettings = {}
  } = {}
) {
  const roots =
    getWorkspaceRoots(
      workspaceSettings
    );

  if (roots.length === 0) {
    const error = new Error(
      "没有配置可读取的工作区。"
    );
    error.code =
      "WORKSPACE_NOT_CONFIGURED";
    throw error;
  }

  const source =
    String(inputPath ?? ".")
      .trim() || ".";

  const candidates =
    path.isAbsolute(source)
      ? [path.resolve(source)]
      : roots.map(
          (root) =>
            path.resolve(
              root,
              source
            )
        );

  let selected = null;
  let selectedRoot = null;

  for (
    const candidate
    of candidates
  ) {
    const root =
      roots.find(
        (item) =>
          isWithinRoot(
            candidate,
            item
          )
      );

    if (!root) {
      continue;
    }

    if (
      mustExist &&
      !fs.existsSync(candidate)
    ) {
      continue;
    }

    selected = candidate;
    selectedRoot = root;
    break;
  }

  if (!selected || !selectedRoot) {
    const error = new Error(
      "路径不存在，或不在允许的工作区内。"
    );
    error.code =
      "PATH_OUTSIDE_WORKSPACE";
    throw error;
  }

  const realPath =
    mustExist
      ? fs.realpathSync(selected)
      : selected;

  const realRoot =
    fs.existsSync(selectedRoot)
      ? fs.realpathSync(selectedRoot)
      : selectedRoot;

  if (
    !isWithinRoot(
      realPath,
      realRoot
    )
  ) {
    const error = new Error(
      "符号链接指向了工作区之外。"
    );
    error.code =
      "SYMLINK_ESCAPE_BLOCKED";
    throw error;
  }

  if (
    isSensitiveWorkspacePath(
      realPath
    )
  ) {
    const error = new Error(
      "该路径属于敏感文件或凭据目录，已拒绝读取。"
    );
    error.code =
      "SENSITIVE_PATH_BLOCKED";
    throw error;
  }

  if (mustExist) {
    const stat =
      fs.statSync(realPath);

    if (
      stat.isDirectory() &&
      !allowDirectory
    ) {
      const error = new Error(
        "该工具只接受文件路径。"
      );
      error.code =
        "FILE_REQUIRED";
      throw error;
    }

    if (
      stat.isFile() &&
      !allowFile
    ) {
      const error = new Error(
        "该工具只接受目录路径。"
      );
      error.code =
        "DIRECTORY_REQUIRED";
      throw error;
    }
  }

  return {
    path: realPath,
    root: realRoot,
    relativePath:
      path.relative(
        realRoot,
        realPath
      ) || "."
  };
}

export function resolveWorkspaceWritePath(
  inputPath,
  {
    workspaceSettings = {},
    allowCreateDirectories = false
  } = {}
) {
  const roots = getWorkspaceRoots(workspaceSettings);
  if (roots.length === 0) {
    const error = new Error("没有配置可写入的工作区。");
    error.code = "WORKSPACE_NOT_CONFIGURED";
    throw error;
  }

  const source = String(inputPath ?? "").trim();
  if (!source || source === ".") {
    const error = new Error("写入工具需要明确的文件路径。");
    error.code = "FILE_REQUIRED";
    throw error;
  }

  const candidates = path.isAbsolute(source)
    ? [path.resolve(source)]
    : roots.map((root) => path.resolve(root, source));

  for (const candidate of candidates) {
    const configuredRoot = roots.find((root) => isWithinRoot(candidate, root));
    if (!configuredRoot) {
      continue;
    }

    const realRoot = fs.existsSync(configuredRoot)
      ? fs.realpathSync(configuredRoot)
      : configuredRoot;
    const parent = path.dirname(candidate);
    let probe = parent;

    while (!fs.existsSync(probe)) {
      const next = path.dirname(probe);
      if (next === probe || !isWithinRoot(next, configuredRoot)) {
        probe = "";
        break;
      }
      probe = next;
    }

    if (!probe) {
      continue;
    }

    const realProbe = fs.realpathSync(probe);
    if (!isWithinRoot(realProbe, realRoot)) {
      const error = new Error("符号链接指向了工作区之外。");
      error.code = "SYMLINK_ESCAPE_BLOCKED";
      throw error;
    }

    if (!allowCreateDirectories && !fs.existsSync(parent)) {
      const error = new Error("目标目录不存在。");
      error.code = "DIRECTORY_NOT_FOUND";
      throw error;
    }

    if (fs.existsSync(candidate)) {
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) {
        const error = new Error("拒绝覆盖符号链接。");
        error.code = "SYMLINK_WRITE_BLOCKED";
        throw error;
      }
      if (!stat.isFile()) {
        const error = new Error("该工具只接受文件路径。");
        error.code = "FILE_REQUIRED";
        throw error;
      }
    }

    if (isSensitiveWorkspacePath(candidate)) {
      const error = new Error("该路径属于敏感文件或凭据目录，已拒绝写入。");
      error.code = "SENSITIVE_PATH_BLOCKED";
      throw error;
    }

    return {
      path: candidate,
      root: realRoot,
      relativePath: path.relative(realRoot, candidate) || "."
    };
  }

  const error = new Error("路径不在允许的工作区内。");
  error.code = "PATH_OUTSIDE_WORKSPACE";
  throw error;
}
