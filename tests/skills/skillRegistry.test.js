import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  SkillRegistry
} from "../../electron/skills/SkillRegistry.js";

import {
  SkillStore
} from "../../electron/skills/SkillStore.js";

function createPackage(root) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "skill.json"), JSON.stringify({
    schemaVersion: 1,
    id: "review",
    name: "Review",
    version: "1.0.0",
    description: "Review changes.",
    modes: ["coding"],
    requiredCapabilities: ["git.read.diff"],
    optionalCapabilities: ["workspace.file.read"],
    permissions: { localWrite: "deny" }
  }), "utf8");
  fs.writeFileSync(path.join(root, "SKILL.md"), "# Review\n\nInspect diffs.", "utf8");
}

test("Skill Registry installs, toggles, detects changes and uninstalls", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-registry-"));
  try {
    const source = path.join(temp, "source");
    const root = path.join(temp, "skills");
    createPackage(source);
    const registry = new SkillRegistry({
      store: new SkillStore({ getFilePath: () => path.join(root, "registry.json") }),
      getRootDirectory: () => root,
      now: (() => { let current = 100; return () => ++current; })(),
      createId: (() => { let current = 0; return () => `id-${++current}`; })()
    });

    const installed = registry.installFromDirectory(source);
    assert.equal(installed.ok, true);
    assert.equal(installed.skill.enabled, true);
    assert.equal(installed.skill.integrity, "verified");
    assert.equal(registry.getState().total, 1);
    assert.match(registry.getRuntimeState({ mode: "coding" }).skills[0].runtimeFingerprint, /^[a-f0-9]{64}$/u);

    const duplicate = registry.installFromDirectory(source);
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.code, "skill-already-installed");

    const toggled = registry.setEnabled("review", false);
    assert.equal(toggled.ok, true);
    assert.equal(registry.getState().disabled, 1);

    fs.appendFileSync(path.join(root, "review", "SKILL.md"), "\nchanged", "utf8");
    assert.equal(registry.get("review").integrity, "changed");

    const removed = registry.uninstall("review");
    assert.equal(removed.ok, true);
    assert.equal(registry.getState().total, 0);
    assert.equal(fs.existsSync(path.join(root, "review")), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("Skill Registry keeps committed state when a broadcast listener fails", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-registry-broadcast-"));
  try {
    const source = path.join(temp, "source");
    const root = path.join(temp, "skills");
    createPackage(source);
    const registry = new SkillRegistry({
      store: new SkillStore({ getFilePath: () => path.join(root, "registry.json") }),
      getRootDirectory: () => root,
      onChange: () => {
        throw new Error("renderer closed");
      }
    });

    const installed = registry.installFromDirectory(source);
    assert.equal(installed.ok, true);
    assert.equal(registry.getState().available, 1);
    assert.equal(registry.getState().revision, 1);
    assert.equal(fs.existsSync(path.join(root, "review", "SKILL.md")), true);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("Skill Store removes duplicate registry ids using the newest entry", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-store-dedupe-"));
  try {
    const filePath = path.join(temp, "registry.json");
    const base = {
      schemaVersion: 1,
      id: "review",
      name: "Review",
      version: "1.0.0",
      description: "Review changes.",
      modes: ["coding"],
      requiredCapabilities: ["git.read.diff"],
      optionalCapabilities: [],
      permissions: { localWrite: "deny" },
      manifestHash: "a".repeat(64),
      promptHash: "b".repeat(64),
      packageHash: "c".repeat(64),
      installedAt: 1,
      sourceType: "directory"
    };
    fs.writeFileSync(filePath, JSON.stringify({
      version: 1,
      skills: [
        { ...base, name: "Old", updatedAt: 10 },
        { ...base, name: "New", updatedAt: 20 }
      ]
    }), "utf8");

    const loaded = new SkillStore({ getFilePath: () => filePath }).load();
    assert.equal(loaded.skills.length, 1);
    assert.equal(loaded.skills[0].name, "New");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
