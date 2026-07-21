import crypto from "node:crypto";

import {
  z
} from "zod";

import {
  isKnownCapability,
  normalizeCapabilityIds
} from "../tools/capabilities/CapabilityTaxonomy.js";

export const SKILL_SCHEMA_VERSION = 1;
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
  keywords: z.array(z.string()).optional().default([])
}).strict();

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
  if (!modes.length || modes.length !== new Set(source.modes.map((value) => String(value).trim().toLowerCase())).size) {
    issues.push({ path: "modes", message: "modes 只能包含 Chat 或 Coding，且至少包含一个。" });
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
    keywords
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
  if (bytes > 262144) {
    return {
      ok: false,
      code: "skill-markdown-too-large",
      message: "SKILL.md 不能超过 256 KB。"
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
