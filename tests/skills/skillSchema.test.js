import assert from "node:assert/strict";
import test from "node:test";

import {
  validateSkillManifest,
  validateSkillMarkdown
} from "../../electron/skills/skillSchema.js";

const VALID = {
  schemaVersion: 1,
  id: "code-review",
  name: "Code Review",
  version: "1.0.0",
  description: "检查当前工作区代码改动。",
  modes: ["Coding"],
  requiredCapabilities: ["workspace.file.read", "git.read.diff"],
  optionalCapabilities: ["workspace.file.modify"],
  permissions: {
    localWrite: "ask",
    externalWrite: "deny",
    destructive: "deny"
  }
};

test("Skill manifest normalizes modes, capabilities and permission defaults", () => {
  const result = validateSkillManifest(VALID);
  assert.equal(result.ok, true);
  assert.deepEqual(result.manifest.modes, ["coding"]);
  assert.deepEqual(result.manifest.requiredCapabilities, ["git.read.diff", "workspace.file.read"]);
  assert.equal(result.manifest.permissions.localWrite, "ask");
  assert.equal(result.manifest.permissions.process, "deny");
  assert.match(result.manifestHash, /^[a-f0-9]{64}$/u);
});

test("Skill manifest rejects unknown capabilities and overlapping requests", () => {
  const result = validateSkillManifest({
    ...VALID,
    requiredCapabilities: ["workspace.file.read", "unknown.capability"],
    optionalCapabilities: ["workspace.file.read"]
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "skill-manifest-invalid");
  assert.ok(result.issues.some((issue) => issue.message.includes("unknown.capability")));
  assert.ok(result.issues.some((issue) => issue.message.includes("同时")));
});

test("Skill markdown requires content and a heading", () => {
  assert.equal(validateSkillMarkdown("").ok, false);
  assert.equal(validateSkillMarkdown("plain text only").ok, false);
  const result = validateSkillMarkdown("# Debug\n\nInspect the workspace.");
  assert.equal(result.ok, true);
  assert.match(result.promptHash, /^[a-f0-9]{64}$/u);
});

test("Skill manifest rejects duplicate modes and oversized prompts", () => {
  const duplicateModes = validateSkillManifest({
    ...VALID,
    modes: ["chat", "chat"]
  });
  assert.equal(duplicateModes.ok, false);
  assert.ok(duplicateModes.issues.some((issue) => issue.path === "modes"));

  const oversized = validateSkillMarkdown(`# Large\n\n${"x".repeat(64 * 1024)}`);
  assert.equal(oversized.ok, false);
  assert.equal(oversized.code, "skill-markdown-too-large");
});
