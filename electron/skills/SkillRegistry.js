import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  copySkillDirectory,
  extractSkillZip,
  inspectSkillPackage
} from "./SkillPackage.js";

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

  commit() {
    this.store.save(this.ensureLoaded());
    this.onChange(this.getState());
  }

  publicSkill(entry, { developerMode = false } = {}) {
    const installedPath = this.installedDirectory(entry.id);
    let integrity = "missing";
    let packageInfo = null;
    if (fs.existsSync(installedPath)) {
      packageInfo = inspectSkillPackage(installedPath);
      integrity = packageInfo.ok
        ? packageInfo.packageHash === entry.packageHash ? "verified" : "changed"
        : "invalid";
    }
    const skill = {
      id: entry.id,
      name: entry.name,
      version: entry.version,
      description: entry.description,
      modes: [...(entry.modes ?? [])],
      requiredCapabilities: [...(entry.requiredCapabilities ?? [])],
      optionalCapabilities: [...(entry.optionalCapabilities ?? [])],
      permissions: clone(entry.permissions ?? {}),
      author: entry.author ?? "",
      homepage: entry.homepage ?? "",
      license: entry.license ?? "",
      keywords: [...(entry.keywords ?? [])],
      enabled: entry.enabled !== false,
      installedAt: Number(entry.installedAt ?? 0),
      updatedAt: Number(entry.updatedAt ?? 0),
      sourceType: entry.sourceType ?? "unknown",
      sourceName: entry.sourceName ?? "",
      fileCount: Number(entry.fileCount ?? 0),
      totalBytes: Number(entry.totalBytes ?? 0),
      integrity
    };
    if (developerMode) {
      skill.manifestHash = entry.manifestHash;
      skill.promptHash = entry.promptHash;
      skill.packageHash = entry.packageHash;
      skill.installedPath = installedPath;
      skill.integrityError = packageInfo && !packageInfo.ok
        ? { code: packageInfo.code, message: packageInfo.message }
        : null;
    }
    return skill;
  }

  getState(options = {}) {
    const skills = this.ensureLoaded().skills
      .map((entry) => this.publicSkill(entry, options))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    return {
      schemaVersion: 1,
      total: skills.length,
      enabled: skills.filter((skill) => skill.enabled).length,
      disabled: skills.filter((skill) => !skill.enabled).length,
      invalid: skills.filter((skill) => !["verified"].includes(skill.integrity)).length,
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
        return {
          ok: false,
          code: "skill-already-installed",
          message: `Skill ${manifest.id} 已安装。`,
          skill: this.publicSkill(existing)
        };
      }

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
          try {
            fs.rmSync(backup, { recursive: true, force: true });
          } catch (cleanupError) {
            console.warn("清理 Skill 更新备份失败：", cleanupError);
          }
        }
        return {
          ok: true,
          installed: !existing,
          updated: Boolean(existing),
          skill: this.publicSkill(entry)
        };
      } catch (error) {
        this.ensureLoaded().skills = previousSkills;
        if (fs.existsSync(target)) {
          fs.rmSync(target, { recursive: true, force: true });
        }
        if (backup && fs.existsSync(backup)) {
          fs.renameSync(backup, target);
        }
        throw error;
      }
    } catch (error) {
      return {
        ok: false,
        code: error?.code ?? "skill-install-failed",
        message: String(error?.message ?? "Skill 安装失败。")
      };
    } finally {
      if (!moved) fs.rmSync(staging, { recursive: true, force: true });
    }
  }

  setEnabled(skillId, enabled) {
    const id = String(skillId ?? "").trim();
    const data = this.ensureLoaded();
    const entry = data.skills.find((skill) => skill.id === id);
    if (!entry) return { ok: false, code: "skill-not-found", message: "Skill 不存在。" };

    if (enabled === true) {
      const installedPath = this.installedDirectory(entry.id);
      const inspected = fs.existsSync(installedPath)
        ? inspectSkillPackage(installedPath)
        : null;
      if (!inspected?.ok || inspected.packageHash !== entry.packageHash) {
        return {
          ok: false,
          code: "skill-integrity-invalid",
          message: "Skill 文件缺失、无效或已发生变化，不能启用。"
        };
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
      return {
        ok: false,
        code: "skill-state-save-failed",
        message: String(error?.message ?? "保存 Skill 状态失败。")
      };
    }
  }

  uninstall(skillId) {
    const id = String(skillId ?? "").trim();
    const data = this.ensureLoaded();
    const entry = data.skills.find((skill) => skill.id === id);
    if (!entry) return { ok: false, code: "skill-not-found", message: "Skill 不存在。" };
    const root = this.rootDirectory();
    const target = this.installedDirectory(id);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return { ok: false, code: "skill-path-invalid", message: "Skill 安装路径无效。" };
    }

    const quarantine = `${target}.uninstall.${this.createId()}`;
    const previousSkills = clone(data.skills);
    try {
      if (fs.existsSync(target)) {
        fs.renameSync(target, quarantine);
      }
      data.skills = data.skills.filter((skill) => skill.id !== id);
      this.commit();
      try {
        fs.rmSync(quarantine, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn("清理已卸载 Skill 目录失败：", cleanupError);
      }
      return { ok: true, skillId: id };
    } catch (error) {
      data.skills = previousSkills;
      if (fs.existsSync(quarantine) && !fs.existsSync(target)) {
        try {
          fs.renameSync(quarantine, target);
        } catch (restoreError) {
          return {
            ok: false,
            code: "skill-uninstall-recovery-required",
            message: `卸载失败且目录恢复失败：${String(restoreError?.message ?? restoreError)}`
          };
        }
      }
      return { ok: false, code: "skill-uninstall-failed", message: String(error?.message ?? "卸载 Skill 失败。") };
    }
  }
}
