import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  copySkillDirectory,
  extractSkillZip,
  inspectSkillPackage
} from "./SkillPackage.js";

import {
  dependencySummaryForSkill,
  requiredBySkills,
  resolveSkillDependencyGraph
} from "./SkillDependencies.js";

function clone(value) {
  return structuredClone(value);
}

function safeSourceName(value) {
  return path.basename(String(value ?? "")).slice(0, 180);
}

export class SkillRegistry {
  constructor({
    store,
    getRootDirectory,
    now = () => Date.now(),
    createId = () => crypto.randomUUID(),
    onChange = () => {}
  }) {
    if (!store || typeof getRootDirectory !== "function") {
      throw new TypeError("SkillRegistry requires store and getRootDirectory.");
    }
    this.store = store;
    this.getRootDirectory = getRootDirectory;
    this.now = now;
    this.createId = createId;
    this.onChange = onChange;
    this.data = null;
    this.revision = 0;
  }

  ensureLoaded() {
    if (!this.data) this.data = this.store.load();
    return this.data;
  }

  rootDirectory() {
    return path.resolve(this.getRootDirectory());
  }

  installedDirectory(skillId) {
    return path.join(this.rootDirectory(), skillId);
  }

  stagingDirectory() {
    return path.join(this.rootDirectory(), ".staging", this.createId());
  }

  notify(state = this.getState()) {
    try {
      this.onChange(state);
    } catch (error) {
      console.warn("广播 Skill 状态失败：", error);
    }
  }

  commit() {
    this.store.save(this.ensureLoaded());
    this.revision += 1;
    const state = this.getState();
    this.notify(state);
    return state;
  }

  integrityForEntry(entry) {
    const installedPath = this.installedDirectory(entry.id);
    if (!fs.existsSync(installedPath)) {
      return { integrity: "missing", packageInfo: null };
    }
    const packageInfo = inspectSkillPackage(installedPath);
    const integrity = packageInfo.ok
      ? packageInfo.packageHash === entry.packageHash ? "verified" : "changed"
      : "invalid";
    return { integrity, packageInfo };
  }

  entriesWithRuntimeState() {
    const entries = this.ensureLoaded().skills.map((entry) => {
      const { integrity } = this.integrityForEntry(entry);
      return { ...entry, integrity };
    });
    return entries.map((entry) => {
      const dependencyState = dependencySummaryForSkill(entries, entry.id);
      return {
        ...entry,
        dependencyState,
        available: entry.enabled !== false && entry.integrity === "verified" && dependencyState.ok
      };
    });
  }

  publicSkill(entry, { developerMode = false, runtimeEntries = null } = {}) {
    const entries = runtimeEntries ?? this.entriesWithRuntimeState();
    const runtimeEntry = entries.find((item) => item.id === entry.id) ?? entry;
    const { integrity, packageInfo } = this.integrityForEntry(entry);
    const dependencyState = runtimeEntry.dependencyState ?? dependencySummaryForSkill(entries, entry.id);
    const available = entry.enabled !== false && integrity === "verified" && dependencyState.ok;
    const skill = {
      id: entry.id,
      name: entry.name,
      version: entry.version,
      description: entry.description,
      modes: [...(entry.modes ?? [])],
      requiredCapabilities: [...(entry.requiredCapabilities ?? [])],
      optionalCapabilities: [...(entry.optionalCapabilities ?? [])],
      permissions: clone(entry.permissions ?? {}),
      dependencies: clone(entry.dependencies ?? []),
      dependencyState: clone(dependencyState),
      author: entry.author ?? "",
      homepage: entry.homepage ?? "",
      license: entry.license ?? "",
      keywords: [...(entry.keywords ?? [])],
      enabled: entry.enabled !== false,
      available,
      installedAt: Number(entry.installedAt ?? 0),
      updatedAt: Number(entry.updatedAt ?? 0),
      sourceType: entry.sourceType ?? "unknown",
      sourceName: entry.sourceName ?? "",
      fileCount: Number(entry.fileCount ?? 0),
      totalBytes: Number(entry.totalBytes ?? 0),
      integrity,
      runtimeFingerprint: String(entry.packageHash ?? "")
    };
    if (developerMode) {
      skill.manifestHash = entry.manifestHash;
      skill.promptHash = entry.promptHash;
      skill.packageHash = entry.packageHash;
      skill.installedPath = this.installedDirectory(entry.id);
      skill.integrityError = integrity === "verified"
        ? null
        : integrity === "changed"
          ? { code: "skill-integrity-changed", message: "Skill 文件内容与安装记录不一致。" }
          : integrity === "missing"
            ? { code: "skill-package-missing", message: "Skill 安装目录不存在。" }
            : packageInfo && !packageInfo.ok
              ? { code: packageInfo.code, message: packageInfo.message }
              : { code: "skill-package-invalid", message: "Skill 包无法通过完整性检查。" };
    }
    return skill;
  }

  getState(options = {}) {
    const runtimeEntries = this.entriesWithRuntimeState();
    const skills = runtimeEntries
      .map((entry) => this.publicSkill(entry, { ...options, runtimeEntries }))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    return {
      schemaVersion: 2,
      revision: this.revision,
      total: skills.length,
      enabled: skills.filter((skill) => skill.enabled).length,
      disabled: skills.filter((skill) => !skill.enabled).length,
      available: skills.filter((skill) => skill.available).length,
      unavailable: skills.filter((skill) => !skill.available).length,
      invalid: skills.filter((skill) => skill.integrity !== "verified").length,
      dependencyIssues: skills.filter((skill) => !skill.dependencyState?.ok).length,
      skills
    };
  }

  list(options = {}) {
    return this.getState(options).skills;
  }

  get(skillId, options = {}) {
    const entry = this.ensureLoaded().skills.find((skill) => skill.id === String(skillId ?? ""));
    return entry ? this.publicSkill(entry, options) : null;
  }

  getRuntimeState({ mode = null } = {}) {
    const normalizedMode = mode === "coding" ? "coding" : mode === "chat" ? "chat" : null;
    const skills = this.list()
      .filter((skill) =>
        skill.enabled &&
        skill.integrity === "verified" &&
        skill.dependencyState?.ok !== false &&
        (!normalizedMode || skill.modes.includes(normalizedMode))
      )
      .map((skill) => ({
        id: skill.id,
        name: skill.name,
        version: skill.version,
        description: skill.description,
        modes: [...skill.modes],
        requiredCapabilities: [...skill.requiredCapabilities],
        optionalCapabilities: [...skill.optionalCapabilities],
        permissions: clone(skill.permissions),
        dependencies: clone(skill.dependencies),
        dependencyState: clone(skill.dependencyState),
        keywords: [...(skill.keywords ?? [])],
        integrity: skill.integrity,
        runtimeFingerprint: skill.runtimeFingerprint
      }));

    return {
      schemaVersion: 2,
      revision: this.revision,
      mode: normalizedMode,
      total: skills.length,
      skills
    };
  }

  installFromDirectory(sourceDirectory, options = {}) {
    return this.install({ sourceType: "directory", sourcePath: sourceDirectory, replaceExisting: options.replaceExisting === true });
  }

  installFromZip(sourcePath, options = {}) {
    return this.install({ sourceType: "zip", sourcePath, replaceExisting: options.replaceExisting === true });
  }

  install({ sourceType, sourcePath, replaceExisting = false }) {
    const root = this.rootDirectory();
    const staging = this.stagingDirectory();
    fs.mkdirSync(path.dirname(staging), { recursive: true });
    let moved = false;
    try {
      const imported = sourceType === "zip"
        ? extractSkillZip(sourcePath, staging)
        : copySkillDirectory(sourcePath, staging);
      if (!imported.ok) return imported;

      const inspected = inspectSkillPackage(staging);
      if (!inspected.ok) return inspected;
      const manifest = inspected.manifest;
      const existing = this.ensureLoaded().skills.find((skill) => skill.id === manifest.id);
      if (existing && !replaceExisting) {
        return { ok: false, code: "skill-already-installed", message: `Skill ${manifest.id} 已安装。`, skill: this.publicSkill(existing) };
      }

      const candidateEntries = [
        { ...manifest, enabled: existing?.enabled ?? true, integrity: "verified" },
        ...this.ensureLoaded().skills.filter((skill) => skill.id !== manifest.id).map((skill) => ({ ...skill, integrity: "verified" }))
      ];
      const graph = resolveSkillDependencyGraph({ skills: candidateEntries, rootSkillIds: [manifest.id] });
      const cycle = graph.diagnostics.find((item) => item.code === "skill-dependency-cycle" || item.code === "skill-dependency-graph-too-large");
      if (cycle) return { ok: false, code: cycle.code, message: cycle.message, details: cycle };

      const target = this.installedDirectory(manifest.id);
      let backup = null;
      if (fs.existsSync(target)) {
        backup = `${target}.backup.${this.createId()}`;
        fs.renameSync(target, backup);
      }

      const previousSkills = clone(this.ensureLoaded().skills);
      try {
        fs.mkdirSync(root, { recursive: true });
        fs.renameSync(staging, target);
        moved = true;

        const timestamp = this.now();
        const entry = {
          ...manifest,
          enabled: existing?.enabled ?? true,
          manifestHash: inspected.manifestHash,
          promptHash: inspected.promptHash,
          packageHash: inspected.packageHash,
          fileCount: inspected.fileCount,
          totalBytes: inspected.totalBytes,
          sourceType,
          sourceName: safeSourceName(sourcePath),
          installedAt: existing?.installedAt ?? timestamp,
          updatedAt: timestamp
        };
        const data = this.ensureLoaded();
        data.skills = [entry, ...data.skills.filter((skill) => skill.id !== manifest.id)];
        this.commit();
        if (backup) {
          try { fs.rmSync(backup, { recursive: true, force: true }); } catch (cleanupError) {
            console.warn("清理 Skill 更新备份失败：", cleanupError);
          }
        }
        return { ok: true, installed: !existing, updated: Boolean(existing), skill: this.publicSkill(entry) };
      } catch (error) {
        this.ensureLoaded().skills = previousSkills;
        if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
        if (backup && fs.existsSync(backup)) fs.renameSync(backup, target);
        throw error;
      }
    } catch (error) {
      return { ok: false, code: error?.code ?? "skill-install-failed", message: String(error?.message ?? "Skill 安装失败。") };
    } finally {
      if (!moved) fs.rmSync(staging, { recursive: true, force: true });
    }
  }

  setEnabled(skillId, enabled) {
    const id = String(skillId ?? "").trim();
    const data = this.ensureLoaded();
    const entry = data.skills.find((skill) => skill.id === id);
    if (!entry) return { ok: false, code: "skill-not-found", message: "Skill 不存在。" };
    if (entry.enabled === Boolean(enabled)) return { ok: true, unchanged: true, skill: this.publicSkill(entry) };

    if (enabled === false) {
      const dependents = requiredBySkills(data.skills, id, { enabledOnly: true });
      if (dependents.length) {
        return {
          ok: false,
          code: "skill-required-by-enabled-skill",
          message: `该 Skill 被已启用的 ${dependents.map((skill) => skill.name).join("、")} 依赖，不能禁用。`,
          dependents: dependents.map((skill) => skill.id)
        };
      }
    }

    if (enabled === true) {
      const installedPath = this.installedDirectory(entry.id);
      const inspected = fs.existsSync(installedPath) ? inspectSkillPackage(installedPath) : null;
      if (!inspected?.ok || inspected.packageHash !== entry.packageHash) {
        return { ok: false, code: "skill-integrity-invalid", message: "Skill 文件缺失、无效或已发生变化，不能启用。" };
      }
      const runtimeEntries = this.entriesWithRuntimeState().map((item) => item.id === id ? { ...item, enabled: true } : item);
      const graph = resolveSkillDependencyGraph({ skills: runtimeEntries, rootSkillIds: [id] });
      if (!graph.ok) {
        return { ok: false, code: graph.diagnostics[0].code, message: graph.diagnostics[0].message, diagnostics: graph.diagnostics };
      }
    }

    const previousEnabled = entry.enabled;
    const previousUpdatedAt = entry.updatedAt;
    try {
      entry.enabled = Boolean(enabled);
      entry.updatedAt = this.now();
      this.commit();
      return { ok: true, skill: this.publicSkill(entry) };
    } catch (error) {
      entry.enabled = previousEnabled;
      entry.updatedAt = previousUpdatedAt;
      return { ok: false, code: "skill-state-save-failed", message: String(error?.message ?? "保存 Skill 状态失败。") };
    }
  }

  uninstall(skillId) {
    const id = String(skillId ?? "").trim();
    const data = this.ensureLoaded();
    const entry = data.skills.find((skill) => skill.id === id);
    if (!entry) return { ok: false, code: "skill-not-found", message: "Skill 不存在。" };
    const dependents = requiredBySkills(data.skills, id, { enabledOnly: true });
    if (dependents.length) {
      return {
        ok: false,
        code: "skill-required-by-enabled-skill",
        message: `该 Skill 被已启用的 ${dependents.map((skill) => skill.name).join("、")} 依赖，不能卸载。`,
        dependents: dependents.map((skill) => skill.id)
      };
    }

    const root = this.rootDirectory();
    const target = this.installedDirectory(id);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return { ok: false, code: "skill-path-invalid", message: "Skill 安装路径无效。" };
    }

    const quarantine = `${target}.uninstall.${this.createId()}`;
    const previousSkills = clone(data.skills);
    try {
      if (fs.existsSync(target)) fs.renameSync(target, quarantine);
      data.skills = data.skills.filter((skill) => skill.id !== id);
      this.commit();
      try { fs.rmSync(quarantine, { recursive: true, force: true }); } catch (cleanupError) {
        console.warn("清理已卸载 Skill 目录失败：", cleanupError);
      }
      return { ok: true, skillId: id };
    } catch (error) {
      data.skills = previousSkills;
      if (fs.existsSync(quarantine) && !fs.existsSync(target)) {
        try { fs.renameSync(quarantine, target); } catch (restoreError) {
          return { ok: false, code: "skill-uninstall-recovery-required", message: `卸载失败且目录恢复失败：${String(restoreError?.message ?? restoreError)}` };
        }
      }
      return { ok: false, code: "skill-uninstall-failed", message: String(error?.message ?? "卸载 Skill 失败。") };
    }
  }
}
