import {
  satisfiesSkillVersion
} from "./SkillVersion.js";

export const MAX_SKILL_ROOTS = 4;
export const MAX_SKILL_GRAPH_SIZE = 12;

export function normalizeSkillIds(values, maxItems = MAX_SKILL_ROOTS) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : values ? [values] : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    )
  ].slice(0, maxItems);
}

export function requiredBySkills(skills, skillId, { enabledOnly = false } = {}) {
  const id = String(skillId ?? "").trim();
  return (Array.isArray(skills) ? skills : []).filter((skill) =>
    (!enabledOnly || skill.enabled !== false) &&
    (skill.dependencies ?? []).some((dependency) =>
      dependency.id === id && dependency.optional !== true
    )
  );
}

export function resolveSkillDependencyGraph({ skills = [], rootSkillIds = [], mode = null } = {}) {
  const roots = normalizeSkillIds(rootSkillIds);
  const byId = new Map((Array.isArray(skills) ? skills : []).map((skill) => [skill.id, skill]));
  const ordered = [];
  const diagnostics = [];
  const visiting = [];
  const visited = new Set();
  const rootSet = new Set(roots);

  function fail(code, message, details = {}) {
    diagnostics.push({ code, message, ...details });
  }

  function visit(id, parentId = "", dependency = null) {
    if (visited.has(id)) return;
    const cycleIndex = visiting.indexOf(id);
    if (cycleIndex >= 0) {
      const cycle = [...visiting.slice(cycleIndex), id];
      fail("skill-dependency-cycle", `Skill 依赖存在循环：${cycle.join(" → ")}`, { cycle });
      return;
    }
    if (ordered.length + visiting.length >= MAX_SKILL_GRAPH_SIZE) {
      fail("skill-dependency-graph-too-large", `Skill 组合与依赖总数不能超过 ${MAX_SKILL_GRAPH_SIZE}。`);
      return;
    }

    const skill = byId.get(id);
    if (!skill) {
      if (dependency?.optional !== true) {
        fail(
          rootSet.has(id) ? "skill-not-found" : "skill-dependency-missing",
          rootSet.has(id) ? `所选 Skill ${id} 不存在或已被卸载。` : `缺少依赖 Skill：${id}`,
          { skillId: parentId || id, dependencyId: rootSet.has(id) ? "" : id }
        );
      }
      return;
    }
    if (dependency && !satisfiesSkillVersion(skill.version, dependency.version)) {
      if (dependency.optional !== true) {
        fail(
          "skill-dependency-version-mismatch",
          `依赖版本不兼容：${id} 需要 ${dependency.version}，当前为 ${skill.version}。`,
          { skillId: parentId, dependencyId: id, expectedVersion: dependency.version, actualVersion: skill.version }
        );
      }
      return;
    }
    if (skill.enabled === false) {
      if (dependency?.optional !== true || rootSet.has(id)) {
        fail(
          rootSet.has(id) ? "skill-disabled" : "skill-dependency-disabled",
          `Skill ${skill.name ?? id} 已禁用。`,
          { skillId: id, parentId }
        );
      }
      return;
    }
    if (skill.integrity && skill.integrity !== "verified") {
      if (dependency?.optional !== true || rootSet.has(id)) {
        fail(
          rootSet.has(id) ? "skill-integrity-invalid" : "skill-dependency-integrity-invalid",
          `Skill ${skill.name ?? id} 完整性异常。`,
          { skillId: id, parentId }
        );
      }
      return;
    }
    if (mode && Array.isArray(skill.modes) && !skill.modes.includes(mode)) {
      if (dependency?.optional !== true || rootSet.has(id)) {
        fail(
          rootSet.has(id) ? "skill-mode-incompatible" : "skill-dependency-mode-incompatible",
          `Skill ${skill.name ?? id} 不支持当前模式。`,
          { skillId: id, mode }
        );
      }
      return;
    }

    visiting.push(id);
    for (const child of skill.dependencies ?? []) {
      visit(child.id, id, child);
    }
    visiting.pop();
    visited.add(id);
    ordered.push(skill);
  }

  for (const id of roots) visit(id);

  return {
    ok: diagnostics.length === 0,
    rootSkillIds: roots,
    skills: ordered,
    dependencySkillIds: ordered.map((skill) => skill.id).filter((id) => !rootSet.has(id)),
    diagnostics
  };
}

export function dependencySummaryForSkill(skills, skillId) {
  const graph = resolveSkillDependencyGraph({ skills, rootSkillIds: [skillId] });
  return {
    ok: graph.ok,
    dependencies: graph.skills.filter((skill) => skill.id !== skillId).map((skill) => ({
      id: skill.id,
      name: skill.name,
      version: skill.version
    })),
    diagnostics: graph.diagnostics
  };
}
