import crypto from "node:crypto";

import {
  z
} from "zod";

import {
  isKnownCapability,
  normalizeCapabilityIds
} from "../tools/capabilities/CapabilityTaxonomy.js";

import {
  isSupportedSkillVersionRange
} from "./SkillVersion.js";

export const SKILL_SCHEMA_VERSION = 1;
export const SKILL_MARKDOWN_MAX_BYTES = 64 * 1024;
export const SKILL_PACKAGE_DIRECTORIES = Object.freeze([
  "resources",
  "templates",
  "tests"
]);

const SKILL_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const MODE_VALUES = new Set(["chat", "coding"]);
const PERMISSION_LEVELS = new Set(["allow", "ask", "deny"]);
const PERMISSION_KEYS = Object.freeze([
  "localWrite",
  "externalWrite",
  "destructive",
  "process",
  "network",
  "credential",
  "account"
]);

function normalizeModes(values) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim().toLowerCase())
        .filter((value) => MODE_VALUES.has(value))
    )
  ];
}

function normalizePermissionPolicy(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  return Object.fromEntries(
    PERMISSION_KEYS.map((key) => {
      const level = String(source[key] ?? "deny").trim().toLowerCase();
      return [key, PERMISSION_LEVELS.has(level) ? level : "deny"];
    })
  );
}

const dependencyInputSchema = z.object({
  id: z.string(),
  version: z.string().optional().default("*"),
  optional: z.boolean().optional().default(false)
}).strict();

const manifestInputSchema = z.object({
  schemaVersion: z.number().int(),
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  modes: z.array(z.string()).optional().default(["coding"]),
  requiredCapabilities: z.array(z.string()).optional().default([]),
  optionalCapabilities: z.array(z.string()).optional().default([]),
  permissions: z.record(z.string(), z.string()).optional().default({}),
  author: z.string().optional().default(""),
  homepage: z.string().optional().default(""),
  license: z.string().optional().default(""),
  keywords: z.array(z.string()).optional().default([]),
  dependencies: z.array(dependencyInputSchema).optional().default([])
}).strict();


function normalizeDependencies(values) {
  const dependencies = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const id = String(value?.id ?? "").trim();
    const version = String(value?.version ?? "*").trim() || "*";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    dependencies.push({
      id,
      version,
      optional: value?.optional === true
    });
  }
  return dependencies;
}

function stableHash(value) {
  return crypto
    .createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
}

export function validateSkillManifest(input) {
  const parsed = manifestInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "skill-manifest-invalid",
      message: "skill.json 结构无效。",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    };
  }

  const source = parsed.data;
  const id = source.id.trim();
  const name = source.name.trim();
  const version = source.version.trim();
  const description = source.description.trim();
  const modes = normalizeModes(source.modes);
  const requiredCapabilities = normalizeCapabilityIds(source.requiredCapabilities);
  const optionalCapabilities = normalizeCapabilityIds(source.optionalCapabilities);
  const declaredCapabilities = [
    ...source.requiredCapabilities,
    ...source.optionalCapabilities
  ].map((value) => String(value ?? "").trim()).filter(Boolean);
  const unknownCapabilities = [
    ...new Set(declaredCapabilities.filter((idValue) => !isKnownCapability(idValue)))
  ].sort();

  const issues = [];
  if (source.schemaVersion !== SKILL_SCHEMA_VERSION) {
    issues.push({ path: "schemaVersion", message: `仅支持 schemaVersion ${SKILL_SCHEMA_VERSION}。` });
  }
  if (!SKILL_ID_PATTERN.test(id)) {
    issues.push({ path: "id", message: "Skill ID 只能包含小写字母、数字和连字符，长度 1–64。" });
  }
  if (!name || name.length > 80) {
    issues.push({ path: "name", message: "Skill 名称长度必须为 1–80。" });
  }
  if (!SEMVER_PATTERN.test(version)) {
    issues.push({ path: "version", message: "version 必须是语义化版本，例如 1.0.0。" });
  }
  if (!description || description.length > 400) {
    issues.push({ path: "description", message: "description 长度必须为 1–400。" });
  }
  if (!modes.length || modes.length !== source.modes.length) {
    issues.push({ path: "modes", message: "modes 只能包含不重复的 Chat 或 Coding，且至少包含一个。" });
  }
  if (unknownCapabilities.length) {
    issues.push({
      path: "requiredCapabilities",
      message: `存在未知 Capability：${unknownCapabilities.join(", ")}`
    });
  }
  if (requiredCapabilities.length > 32 || optionalCapabilities.length > 32) {
    issues.push({ path: "capabilities", message: "必需与可选 Capability 分别最多 32 项。" });
  }
  const overlap = requiredCapabilities.filter((capability) => optionalCapabilities.includes(capability));
  if (overlap.length) {
    issues.push({ path: "optionalCapabilities", message: `Capability 不能同时为必需与可选：${overlap.join(", ")}` });
  }

  const invalidPermissionKeys = Object.keys(source.permissions).filter((key) => !PERMISSION_KEYS.includes(key));
  const invalidPermissionValues = Object.entries(source.permissions)
    .filter(([key, value]) => PERMISSION_KEYS.includes(key) && !PERMISSION_LEVELS.has(String(value).toLowerCase()))
    .map(([key]) => key);
  if (invalidPermissionKeys.length) {
    issues.push({ path: "permissions", message: `未知权限字段：${invalidPermissionKeys.join(", ")}` });
  }
  if (invalidPermissionValues.length) {
    issues.push({ path: "permissions", message: `权限值只能是 allow、ask 或 deny：${invalidPermissionValues.join(", ")}` });
  }

  const keywords = [
    ...new Set(
      source.keywords
        .map((value) => String(value ?? "").trim())
        .filter((value) => value && value.length <= 40)
    )
  ].slice(0, 20);
  const dependencies = normalizeDependencies(source.dependencies);
  if (source.dependencies.length > 16 || dependencies.length !== source.dependencies.length) {
    issues.push({ path: "dependencies", message: "dependencies 最多 16 项，且不能重复或缺少 ID。" });
  }
  for (const dependency of dependencies) {
    if (!SKILL_ID_PATTERN.test(dependency.id)) {
      issues.push({ path: "dependencies", message: `依赖 Skill ID 无效：${dependency.id}` });
    }
    if (dependency.id === id) {
      issues.push({ path: "dependencies", message: "Skill 不能依赖自身。" });
    }
    if (!isSupportedSkillVersionRange(dependency.version)) {
      issues.push({ path: "dependencies", message: `不支持的依赖版本范围：${dependency.id}@${dependency.version}` });
    }
  }

  if (issues.length) {
    return {
      ok: false,
      code: "skill-manifest-invalid",
      message: "skill.json 校验失败。",
      issues
    };
  }

  const manifest = {
    schemaVersion: SKILL_SCHEMA_VERSION,
    id,
    name,
    version,
    description,
    modes,
    requiredCapabilities,
    optionalCapabilities,
    permissions: normalizePermissionPolicy(source.permissions),
    author: source.author.trim().slice(0, 120),
    homepage: source.homepage.trim().slice(0, 500),
    license: source.license.trim().slice(0, 80),
    keywords,
    dependencies
  };

  return {
    ok: true,
    manifest,
    manifestHash: stableHash(manifest)
  };
}

export function validateSkillMarkdown(value) {
  const content = String(value ?? "").replace(/^\uFEFF/u, "");
  const bytes = Buffer.byteLength(content, "utf8");
  if (!content.trim()) {
    return {
      ok: false,
      code: "skill-markdown-empty",
      message: "SKILL.md 不能为空。"
    };
  }
  if (bytes > SKILL_MARKDOWN_MAX_BYTES) {
    return {
      ok: false,
      code: "skill-markdown-too-large",
      message: "SKILL.md 不能超过 64 KB。较大的参考资料应放入 resources。"
    };
  }
  if (!/^#{1,3}\s+\S+/mu.test(content)) {
    return {
      ok: false,
      code: "skill-markdown-heading-missing",
      message: "SKILL.md 至少需要一个 Markdown 标题。"
    };
  }
  return {
    ok: true,
    content,
    bytes,
    promptHash: stableHash(content)
  };
}

export function permissionKeysForSkill() {
  return [...PERMISSION_KEYS];
}
