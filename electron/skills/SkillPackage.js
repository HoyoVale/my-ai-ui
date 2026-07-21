import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import AdmZip from "adm-zip";

import {
  validateSkillManifest,
  validateSkillMarkdown
} from "./skillSchema.js";

export const SKILL_IMPORT_LIMITS = Object.freeze({
  maxArchiveBytes: 20 * 1024 * 1024,
  maxFiles: 512,
  maxFileBytes: 5 * 1024 * 1024,
  maxTotalBytes: 25 * 1024 * 1024,
  maxDepth: 10,
  maxPathLength: 240
});

const REQUIRED_FILES = Object.freeze(["skill.json", "SKILL.md"]);
const ALLOWED_ROOT_ENTRIES = new Set([
  ...REQUIRED_FILES,
  "resources",
  "templates",
  "tests",
  "README.md",
  "LICENSE",
  "LICENSE.md"
]);

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function normalizedRelativePath(value) {
  const text = String(value ?? "").replace(/\\/gu, "/");
  if (!text || text.includes("\0") || /^[A-Za-z]:/u.test(text) || text.startsWith("/")) {
    return null;
  }
  const normalized = path.posix.normalize(text).replace(/^\.\//u, "");
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length || segments.includes("..") || normalized === "..") {
    return null;
  }
  if (segments.length > SKILL_IMPORT_LIMITS.maxDepth || normalized.length > SKILL_IMPORT_LIMITS.maxPathLength) {
    return null;
  }
  return segments.join("/");
}

function packageRootPrefix(paths) {
  const hasRootManifest = paths.includes("skill.json") || paths.includes("SKILL.md");
  if (hasRootManifest) return "";
  const first = paths[0]?.split("/")[0] ?? "";
  if (!first || !paths.every((entry) => entry === first || entry.startsWith(`${first}/`))) {
    return "";
  }
  return `${first}/`;
}

function validateRootEntries(paths) {
  const roots = new Set(paths.map((entry) => entry.split("/")[0]));
  const unexpected = [...roots].filter((entry) => !ALLOWED_ROOT_ENTRIES.has(entry));
  if (unexpected.length) {
    return {
      ok: false,
      code: "skill-package-root-invalid",
      message: `Skill 根目录包含不支持的项目：${unexpected.join(", ")}`
    };
  }
  for (const required of REQUIRED_FILES) {
    if (!paths.includes(required)) {
      return {
        ok: false,
        code: "skill-package-file-missing",
        message: `Skill 缺少 ${required}。`
      };
    }
  }
  return { ok: true };
}

function writeSafeFile(root, relativePath, data) {
  const destination = path.resolve(root, ...relativePath.split("/"));
  if (!isInside(path.resolve(root), destination)) {
    throw new Error("Skill package path escaped staging directory.");
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, data, { flag: "wx" });
}

function isZipSymlink(entry) {
  const unixMode = Number(entry?.header?.attr ?? 0) >>> 16;
  return (unixMode & 0o170000) === 0o120000;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function collectPackageFiles(root) {
  const files = [];
  const walk = (directory, relativeDirectory = "") => {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relative = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const normalized = normalizedRelativePath(relative);
      if (!normalized) {
        throw Object.assign(new Error(`非法 Skill 路径：${relative}`), { code: "skill-package-path-invalid" });
      }
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        throw Object.assign(new Error(`Skill 不允许符号链接：${relative}`), { code: "skill-package-symlink" });
      }
      if (stat.isDirectory()) {
        walk(absolute, normalized);
      } else if (stat.isFile()) {
        files.push({ relativePath: normalized, absolutePath: absolute, size: stat.size });
      } else {
        throw Object.assign(new Error(`Skill 包含不支持的文件类型：${relative}`), { code: "skill-package-file-type" });
      }
    }
  };
  walk(root);
  return files;
}

function enforceFileLimits(files) {
  if (files.length > SKILL_IMPORT_LIMITS.maxFiles) {
    return { ok: false, code: "skill-package-too-many-files", message: `Skill 最多包含 ${SKILL_IMPORT_LIMITS.maxFiles} 个文件。` };
  }
  let totalBytes = 0;
  for (const file of files) {
    if (file.size > SKILL_IMPORT_LIMITS.maxFileBytes) {
      return { ok: false, code: "skill-package-file-too-large", message: `${file.relativePath} 超过单文件 5 MB 限制。` };
    }
    totalBytes += file.size;
  }
  if (totalBytes > SKILL_IMPORT_LIMITS.maxTotalBytes) {
    return { ok: false, code: "skill-package-too-large", message: "Skill 解压后总大小超过 25 MB。" };
  }
  return { ok: true, totalBytes };
}

export function copySkillDirectory(sourceDirectory, stagingDirectory) {
  let sourceRoot;
  let files;
  try {
    sourceRoot = fs.realpathSync(path.resolve(sourceDirectory));
    const stat = fs.statSync(sourceRoot);
    if (!stat.isDirectory()) {
      return { ok: false, code: "skill-source-not-directory", message: "选择的 Skill 来源不是目录。" };
    }
    files = collectPackageFiles(sourceRoot);
  } catch (error) {
    return {
      ok: false,
      code: error?.code ?? "skill-source-invalid",
      message: String(error?.message ?? "读取 Skill 文件夹失败。")
    };
  }
  const limits = enforceFileLimits(files);
  if (!limits.ok) return limits;
  const rootCheck = validateRootEntries(files.map((file) => file.relativePath));
  if (!rootCheck.ok) return rootCheck;
  fs.mkdirSync(stagingDirectory, { recursive: true });
  for (const file of files) {
    writeSafeFile(stagingDirectory, file.relativePath, fs.readFileSync(file.absolutePath));
  }
  return { ok: true, fileCount: files.length, totalBytes: limits.totalBytes };
}

export function extractSkillZip(zipPath, stagingDirectory) {
  const absoluteZip = path.resolve(zipPath);
  const stat = fs.statSync(absoluteZip);
  if (!stat.isFile()) {
    return { ok: false, code: "skill-source-not-file", message: "选择的 Skill ZIP 不存在。" };
  }
  if (stat.size > SKILL_IMPORT_LIMITS.maxArchiveBytes) {
    return { ok: false, code: "skill-archive-too-large", message: "Skill ZIP 不能超过 20 MB。" };
  }

  let entries;
  try {
    entries = new AdmZip(absoluteZip).getEntries();
  } catch {
    return { ok: false, code: "skill-archive-invalid", message: "无法读取 Skill ZIP。" };
  }

  const normalizedEntries = [];
  for (const entry of entries) {
    if (isZipSymlink(entry)) {
      return { ok: false, code: "skill-package-symlink", message: `Skill ZIP 不允许符号链接：${entry.entryName}` };
    }
    const normalized = normalizedRelativePath(entry.entryName.replace(/\/$/u, ""));
    if (!normalized && !entry.isDirectory) {
      return { ok: false, code: "skill-package-path-invalid", message: `Skill ZIP 包含非法路径：${entry.entryName}` };
    }
    if (normalized) normalizedEntries.push({ entry, normalized });
  }

  const prefix = packageRootPrefix(normalizedEntries.map(({ normalized }) => normalized));
  const files = normalizedEntries
    .filter(({ entry }) => !entry.isDirectory)
    .map(({ entry, normalized }) => {
      const relativePath = prefix && normalized.startsWith(prefix)
        ? normalized.slice(prefix.length)
        : normalized;
      return { entry, relativePath, size: Number(entry.header?.size ?? entry.getData().length) };
    });

  if (files.some((file) => !file.relativePath || !normalizedRelativePath(file.relativePath))) {
    return { ok: false, code: "skill-package-path-invalid", message: "Skill ZIP 根目录结构无效。" };
  }
  const limits = enforceFileLimits(files);
  if (!limits.ok) return limits;
  const rootCheck = validateRootEntries(files.map((file) => file.relativePath));
  if (!rootCheck.ok) return rootCheck;

  fs.mkdirSync(stagingDirectory, { recursive: true });
  for (const file of files) {
    writeSafeFile(stagingDirectory, file.relativePath, file.entry.getData());
  }
  return { ok: true, fileCount: files.length, totalBytes: limits.totalBytes };
}

export function inspectSkillPackage(packageDirectory) {
  let files;
  try {
    files = collectPackageFiles(packageDirectory);
  } catch (error) {
    return {
      ok: false,
      code: error?.code ?? "skill-package-invalid",
      message: String(error?.message ?? error)
    };
  }
  const limits = enforceFileLimits(files);
  if (!limits.ok) return limits;
  const rootCheck = validateRootEntries(files.map((file) => file.relativePath));
  if (!rootCheck.ok) return rootCheck;

  let manifestSource;
  let markdown;
  try {
    const manifestText = fs.readFileSync(path.join(packageDirectory, "skill.json"), "utf8").replace(/^\uFEFF/u, "");
    if (Buffer.byteLength(manifestText, "utf8") > 65536) {
      return { ok: false, code: "skill-manifest-too-large", message: "skill.json 不能超过 64 KB。" };
    }
    manifestSource = JSON.parse(manifestText);
    markdown = fs.readFileSync(path.join(packageDirectory, "SKILL.md"), "utf8");
  } catch (error) {
    return {
      ok: false,
      code: error instanceof SyntaxError ? "skill-manifest-json-invalid" : "skill-package-read-failed",
      message: error instanceof SyntaxError ? "skill.json 不是有效 JSON。" : "读取 Skill 核心文件失败。"
    };
  }

  const manifestResult = validateSkillManifest(manifestSource);
  if (!manifestResult.ok) return manifestResult;
  const markdownResult = validateSkillMarkdown(markdown);
  if (!markdownResult.ok) return markdownResult;

  const packageHash = crypto.createHash("sha256");
  for (const file of [...files].sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
    packageHash.update(file.relativePath);
    packageHash.update("\0");
    packageHash.update(sha256File(file.absolutePath));
    packageHash.update("\0");
  }

  return {
    ok: true,
    manifest: manifestResult.manifest,
    manifestHash: manifestResult.manifestHash,
    promptHash: markdownResult.promptHash,
    packageHash: packageHash.digest("hex"),
    fileCount: files.length,
    totalBytes: limits.totalBytes,
    promptBytes: markdownResult.bytes
  };
}
