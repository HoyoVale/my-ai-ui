const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u;
const RANGE_PATTERN = /^(?:\*|latest|(?:\^|~|>=|<=|>|<)?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?|(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.x|(?:0|[1-9]\d*)\.x)$/u;

export function parseSkillVersion(value) {
  const normalized = String(value ?? "").trim();
  const match = SEMVER_PATTERN.exec(normalized);
  if (!match) return null;
  return {
    raw: normalized,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? ""
  };
}

export function isSupportedSkillVersionRange(value) {
  const normalized = String(value ?? "*").trim().toLowerCase() || "*";
  return RANGE_PATTERN.test(normalized);
}

export function compareSkillVersions(leftValue, rightValue) {
  const left = parseSkillVersion(leftValue);
  const right = parseSkillVersion(rightValue);
  if (!left || !right) return null;
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  return left.prerelease.localeCompare(right.prerelease, "en");
}

export function satisfiesSkillVersion(versionValue, rangeValue = "*") {
  const version = parseSkillVersion(versionValue);
  const range = String(rangeValue ?? "*").trim().toLowerCase() || "*";
  if (!version || !isSupportedSkillVersionRange(range)) return false;
  if (range === "*" || range === "latest") return true;

  if (range.endsWith(".x")) {
    const parts = range.split(".");
    if (parts.length === 2) return version.major === Number(parts[0]);
    return version.major === Number(parts[0]) && version.minor === Number(parts[1]);
  }

  const operator = [">=", "<=", "^", "~", ">", "<"]
    .find((candidate) => range.startsWith(candidate)) ?? "";
  const targetText = operator ? range.slice(operator.length) : range;
  const target = parseSkillVersion(targetText);
  if (!target) return false;
  const comparison = compareSkillVersions(version.raw, target.raw);

  if (!operator) return comparison === 0;
  if (operator === ">=") return comparison >= 0;
  if (operator === "<=") return comparison <= 0;
  if (operator === ">") return comparison > 0;
  if (operator === "<") return comparison < 0;
  if (operator === "~") {
    return comparison >= 0 && version.major === target.major && version.minor === target.minor;
  }
  if (operator === "^") {
    if (comparison < 0) return false;
    if (target.major > 0) return version.major === target.major;
    if (target.minor > 0) {
      return version.major === 0 && version.minor === target.minor;
    }
    return version.major === 0 && version.minor === 0 && version.patch === target.patch;
  }
  return false;
}
