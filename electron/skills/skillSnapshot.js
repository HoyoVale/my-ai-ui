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


function dependencyList(values) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const id = text(value?.id, 120);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push({
      id,
      version: text(value?.version, 80) || "*",
      optional: value?.optional === true
    });
  }
  return result.slice(0, 16);
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
    dependencies: dependencyList(source.dependencies),
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

export function createSkillSnapshots(values, maxItems = 12) {
  const snapshots = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const snapshot = createSkillSnapshot(value);
    if (!snapshot || seen.has(snapshot.id)) continue;
    seen.add(snapshot.id);
    snapshots.push(snapshot);
    if (snapshots.length >= maxItems) break;
  }
  return snapshots;
}

export function compareSkillSnapshotSets(expectedValues, actualValues) {
  const expected = new Map(createSkillSnapshots(expectedValues).map((item) => [item.id, item]));
  const actual = new Map(createSkillSnapshots(actualValues).map((item) => [item.id, item]));
  const mismatches = [];
  for (const [id, snapshot] of expected) {
    const comparison = compareSkillSnapshots(snapshot, actual.get(id));
    if (!comparison.matches) mismatches.push({ id, fields: comparison.mismatches });
  }
  for (const id of actual.keys()) {
    if (!expected.has(id)) mismatches.push({ id, fields: ["unexpected"] });
  }
  return { matches: mismatches.length === 0, mismatches };
}
