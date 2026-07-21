import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import AdmZip from "adm-zip";

import {
  copySkillDirectory,
  extractSkillZip,
  inspectSkillPackage
} from "../../electron/skills/SkillPackage.js";

function createPackage(root, id = "debug-skill") {
  fs.mkdirSync(path.join(root, "resources"), { recursive: true });
  fs.writeFileSync(path.join(root, "skill.json"), JSON.stringify({
    schemaVersion: 1,
    id,
    name: "Debug Skill",
    version: "1.0.0",
    description: "定位代码问题。",
    modes: ["coding"],
    requiredCapabilities: ["workspace.file.read"],
    optionalCapabilities: ["workspace.file.modify"],
    permissions: { localWrite: "ask" }
  }), "utf8");
  fs.writeFileSync(path.join(root, "SKILL.md"), "# Debug Skill\n\nRead before writing.", "utf8");
  fs.writeFileSync(path.join(root, "resources", "notes.md"), "reference", "utf8");
}

test("Skill package copies a safe folder and validates its core files", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-package-"));
  try {
    const source = path.join(temp, "source");
    const staging = path.join(temp, "staging");
    createPackage(source);
    const copied = copySkillDirectory(source, staging);
    assert.equal(copied.ok, true);
    const inspected = inspectSkillPackage(staging);
    assert.equal(inspected.ok, true);
    assert.equal(inspected.manifest.id, "debug-skill");
    assert.equal(inspected.fileCount, 3);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("Skill ZIP accepts one wrapper directory", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-zip-"));
  try {
    const source = path.join(temp, "source");
    createPackage(source, "zip-skill");
    const zipPath = path.join(temp, "skill.zip");
    const zip = new AdmZip();
    zip.addLocalFolder(source, "zip-skill");
    zip.writeZip(zipPath);
    const staging = path.join(temp, "staging");
    const extracted = extractSkillZip(zipPath, staging);
    assert.equal(extracted.ok, true);
    const inspected = inspectSkillPackage(staging);
    assert.equal(inspected.ok, true);
    assert.equal(inspected.manifest.id, "zip-skill");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("Skill package rejects unexpected root entries and symlinks", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-unsafe-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const source = path.join(temp, "source");
  createPackage(source);
  fs.writeFileSync(path.join(source, "unexpected.txt"), "no", "utf8");
  const result = copySkillDirectory(source, path.join(temp, "staging"));
  assert.equal(result.ok, false);
  assert.equal(result.code, "skill-package-root-invalid");

  if (process.platform !== "win32") {
    fs.rmSync(path.join(source, "unexpected.txt"));
    fs.symlinkSync("SKILL.md", path.join(source, "link.md"));
    const linked = copySkillDirectory(source, path.join(temp, "linked"));
    assert.equal(linked.ok, false);
    assert.equal(linked.code, "skill-package-symlink");
  }
});
