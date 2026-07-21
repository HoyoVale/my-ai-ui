const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const MODES = new Set(["chat", "coding"]);
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

function text(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function hash(value) {
  const normalized = text(value, 64).toLowerCase();
  return HASH_PATTERN.test(normalized) ? normalized : "";
}

function stringList(values, maxItems = 32, maxLength = 160) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => text(value, maxLength))
        .filter(Boolean)
    )
  ].slice(0, maxItems);
}

function permissions(value) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  return Object.fromEntries(
    PERMISSION_KEYS.map((key) => {
      const level = text(source[key], 16).toLowerCase();
      return [key, PERMISSION_LEVELS.has(level) ? level : "deny"];
    })
  );
}

export function createSkillSnapshot(source) {
  if (!source || typeof source !== "object") {
    return null;
  }

  const id = text(source.id ?? source.skillId, 120);
  if (!id) {
    return null;
  }

  return {
    id,
    name: text(source.name, 120) || id,
    version: text(source.version, 80),
    description: text(source.description, 400),
    modes: stringList(source.modes, 2, 16).filter((mode) => MODES.has(mode)),
    requiredCapabilities: stringList(source.requiredCapabilities),
    optionalCapabilities: stringList(source.optionalCapabilities),
    permissions: permissions(source.permissions),
    manifestHash: hash(source.manifestHash),
    promptHash: hash(source.promptHash),
    packageHash: hash(source.packageHash)
  };
}

export function compareSkillSnapshots(expected, actual) {
  const left = createSkillSnapshot(expected);
  const right = createSkillSnapshot(actual);

  if (!left || !right) {
    return {
      matches: !left && !right,
      mismatches: !left && !right ? [] : ["snapshot"]
    };
  }

  const mismatches = [];
  if (left.id !== right.id) mismatches.push("id");
  if (left.version && left.version !== right.version) mismatches.push("version");
  for (const key of ["manifestHash", "promptHash", "packageHash"]) {
    if (left[key] && left[key] !== right[key]) mismatches.push(key);
  }

  return {
    matches: mismatches.length === 0,
    mismatches
  };
}

export function skillSnapshotHashFields(snapshot) {
  const value = createSkillSnapshot(snapshot);
  return value
    ? {
        manifestHash: value.manifestHash,
        promptHash: value.promptHash,
        packageHash: value.packageHash
      }
    : {
        manifestHash: "",
        promptHash: "",
        packageHash: ""
      };
}
