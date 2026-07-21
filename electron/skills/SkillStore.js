import fs from "node:fs";
import path from "node:path";

import {
  validateSkillManifest
} from "./skillSchema.js";

const EMPTY_DATA = Object.freeze({
  version: 1,
  skills: []
});

function clone(value) {
  return structuredClone(value);
}

function safeHash(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/u.test(text) ? text : "";
}

function sanitizeRegistryEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const manifestResult = validateSkillManifest({
    schemaVersion: value.schemaVersion,
    id: value.id,
    name: value.name,
    version: value.version,
    description: value.description,
    modes: value.modes,
    requiredCapabilities: value.requiredCapabilities,
    optionalCapabilities: value.optionalCapabilities,
    permissions: value.permissions,
    author: value.author,
    homepage: value.homepage,
    license: value.license,
    keywords: value.keywords
  });

  if (!manifestResult.ok) {
    return null;
  }

  const sourceType = ["directory", "zip"].includes(value.sourceType)
    ? value.sourceType
    : "unknown";

  return {
    ...manifestResult.manifest,
    enabled: value.enabled !== false,
    manifestHash: safeHash(value.manifestHash) || manifestResult.manifestHash,
    promptHash: safeHash(value.promptHash),
    packageHash: safeHash(value.packageHash),
    fileCount: Math.max(0, Math.min(Number(value.fileCount) || 0, 100000)),
    totalBytes: Math.max(0, Math.min(Number(value.totalBytes) || 0, 1024 * 1024 * 1024)),
    sourceType,
    sourceName: String(value.sourceName ?? "").slice(0, 180),
    installedAt: Math.max(0, Number(value.installedAt) || 0),
    updatedAt: Math.max(0, Number(value.updatedAt) || 0)
  };
}

export class SkillStore {
  constructor({ getFilePath }) {
    if (typeof getFilePath !== "function") {
      throw new TypeError("SkillStore requires getFilePath.");
    }
    this.getFilePath = getFilePath;
  }

  getPath() {
    return this.getFilePath();
  }

  load() {
    const filePath = this.getPath();
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return {
        version: 1,
        skills: Array.isArray(parsed?.skills)
          ? parsed.skills.map(sanitizeRegistryEntry).filter(Boolean)
          : []
      };
    } catch (error) {
      if (error?.code !== "ENOENT") {
        console.warn("读取 Skill Registry 失败：", error);
      }
      return clone(EMPTY_DATA);
    }
  }

  save(data) {
    const filePath = this.getPath();
    const directory = path.dirname(filePath);
    fs.mkdirSync(directory, { recursive: true });
    const suffix = `${process.pid}.${Date.now()}`;
    const temporary = `${filePath}.${suffix}.tmp`;
    const backup = `${filePath}.${suffix}.bak`;
    fs.writeFileSync(
      temporary,
      JSON.stringify({ version: 1, skills: data.skills ?? [] }, null, 2),
      "utf8"
    );

    let backedUp = false;
    try {
      if (fs.existsSync(filePath)) {
        fs.renameSync(filePath, backup);
        backedUp = true;
      }
      fs.renameSync(temporary, filePath);
      if (backedUp) fs.rmSync(backup, { force: true });
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      if (backedUp && fs.existsSync(backup) && !fs.existsSync(filePath)) {
        fs.renameSync(backup, filePath);
      }
      throw error;
    }
  }
}
