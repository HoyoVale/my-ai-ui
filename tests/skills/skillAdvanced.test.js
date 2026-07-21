import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createCheckpointContinuationState } from "../../electron/agent/checkpointResume.js";
import { createRunCheckpoint } from "../../electron/agent/runCheckpoint.js";
import { sanitizeActivity } from "../../electron/conversation/activitySchema.js";
import { SkillRegistry } from "../../electron/skills/SkillRegistry.js";
import { SkillStore } from "../../electron/skills/SkillStore.js";
import { parseSkillCommand } from "../../electron/skills/SkillCommand.js";
import { resolveSkillDependencyGraph } from "../../electron/skills/SkillDependencies.js";
import { resolveSkillRuntime } from "../../electron/skills/SkillRuntime.js";
import { routeSkillForMessage } from "../../electron/skills/SkillRouter.js";
import {
  compareSkillVersions,
  satisfiesSkillVersion
} from "../../electron/skills/SkillVersion.js";

function createRegistry(temp) {
  const root = path.join(temp, "skills");
  return new SkillRegistry({
    store: new SkillStore({ getFilePath: () => path.join(root, "registry.json") }),
    getRootDirectory: () => root
  });
}

function writeSkill(directory, {
  id,
  name = id,
  version = "1.0.0",
  description = `${name} workflow`,
  modes = ["chat", "coding"],
  requiredCapabilities = ["runtime.info"],
  optionalCapabilities = [],
  permissions = {},
  keywords = [],
  dependencies = [],
  prompt = `# ${name}\n\nFollow the ${name} workflow.`
}) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "skill.json"), JSON.stringify({
    schemaVersion: 1,
    id,
    name,
    version,
    description,
    modes,
    requiredCapabilities,
    optionalCapabilities,
    permissions,
    keywords,
    dependencies
  }, null, 2), "utf8");
  fs.writeFileSync(path.join(directory, "SKILL.md"), prompt, "utf8");
}

function installSkill(registry, temp, definition) {
  const directory = path.join(temp, `source-${definition.id}`);
  writeSkill(directory, definition);
  const result = registry.installFromDirectory(directory);
  assert.equal(result.ok, true, result.message);
  return result.skill;
}

test("Skill dependency version ranges use bounded semver matching", () => {
  assert.equal(compareSkillVersions("1.2.3", "1.2.4"), -1);
  assert.equal(satisfiesSkillVersion("1.8.0", "^1.2.0"), true);
  assert.equal(satisfiesSkillVersion("2.0.0", "^1.2.0"), false);
  assert.equal(satisfiesSkillVersion("0.2.9", "^0.2.1"), true);
  assert.equal(satisfiesSkillVersion("0.3.0", "^0.2.1"), false);
  assert.equal(satisfiesSkillVersion("1.2.9", "1.2.x"), true);
  assert.equal(satisfiesSkillVersion("1.3.0", "~1.2.0"), false);
});

test("slash Skill commands support one-shot composition without mutating the task text", () => {
  const available = ["debug", "review", "refactor", "docs", "tests"];
  const parsed = parseSkillCommand("/debug /review inspect this project", available);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.skillIds, ["debug", "review"]);
  assert.equal(parsed.content, "inspect this project");

  assert.equal(
    parseSkillCommand("/debug", available).code,
    "skill-command-message-required"
  );
  assert.equal(
    parseSkillCommand("/debug /review /refactor /docs /tests task", available).code,
    "skill-command-limit"
  );
  assert.equal(parseSkillCommand("/unknown task", available).matched, false);
});

test("automatic Skill routing is conservative and mode-aware", () => {
  const skills = [
    {
      id: "debug",
      name: "Debug",
      description: "定位代码错误并分析异常",
      keywords: ["debug", "报错", "崩溃"],
      enabled: true,
      available: true,
      modes: ["coding"]
    },
    {
      id: "writing",
      name: "Writing",
      description: "润色普通文本",
      keywords: ["润色"],
      enabled: true,
      available: true,
      modes: ["chat"]
    }
  ];
  const routed = routeSkillForMessage({
    message: "请 debug 这个崩溃问题",
    skills,
    mode: "coding"
  });
  assert.equal(routed.matched, true);
  assert.deepEqual(routed.skillIds, ["debug"]);

  const noMatch = routeSkillForMessage({
    message: "你好",
    skills,
    mode: "coding"
  });
  assert.equal(noMatch.matched, false);
  assert.deepEqual(noMatch.skillIds, []);
});

test("dependency graph resolves in topological order and reports missing or incompatible dependencies", () => {
  const skills = [
    { id: "shared", name: "Shared", version: "1.2.0", enabled: true, integrity: "verified", modes: ["coding"], dependencies: [] },
    { id: "root", name: "Root", version: "1.0.0", enabled: true, integrity: "verified", modes: ["coding"], dependencies: [{ id: "shared", version: "^1.0.0", optional: false }] }
  ];
  const graph = resolveSkillDependencyGraph({ skills, rootSkillIds: ["root"], mode: "coding" });
  assert.equal(graph.ok, true);
  assert.deepEqual(graph.skills.map((skill) => skill.id), ["shared", "root"]);

  const missing = resolveSkillDependencyGraph({
    skills: [skills[1]],
    rootSkillIds: ["root"],
    mode: "coding"
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.diagnostics[0].code, "skill-dependency-missing");

  const mismatch = resolveSkillDependencyGraph({
    skills: [{ ...skills[0], version: "2.0.0" }, skills[1]],
    rootSkillIds: ["root"],
    mode: "coding"
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.diagnostics[0].code, "skill-dependency-version-mismatch");
});

test("Skill Runtime composes roots and dependencies while intersecting permissions", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-advanced-runtime-"));
  try {
    const registry = createRegistry(temp);
    installSkill(registry, temp, {
      id: "shared",
      name: "Shared",
      permissions: { localWrite: "allow" },
      requiredCapabilities: ["runtime.info"],
      prompt: "# Shared\n\nPrepare shared context."
    });
    installSkill(registry, temp, {
      id: "review",
      name: "Review",
      permissions: { localWrite: "allow" },
      requiredCapabilities: ["workspace.file.read"],
      dependencies: [{ id: "shared", version: "^1.0.0" }],
      prompt: "# Review\n\nReview the selected files."
    });
    installSkill(registry, temp, {
      id: "fix",
      name: "Fix",
      permissions: { localWrite: "ask" },
      requiredCapabilities: ["workspace.file.modify"],
      prompt: "# Fix\n\nApply a bounded fix."
    });

    const runtime = resolveSkillRuntime({
      registry,
      skillIds: ["review", "fix"],
      mode: "coding",
      source: "manual"
    });
    assert.equal(runtime.ok, true);
    assert.deepEqual(runtime.skills.map((skill) => skill.id), ["shared", "review", "fix"]);
    assert.deepEqual(runtime.rootSkillIds, ["review", "fix"]);
    assert.deepEqual(runtime.dependencySkills.map((skill) => skill.id), ["shared"]);
    assert.equal(runtime.capabilityRequest.permissions.workspaceWrite, "ask");
    assert.deepEqual(runtime.capabilityRequest.requiredCapabilities, [
      "runtime.info",
      "workspace.file.read",
      "workspace.file.modify"
    ]);
    assert.ok(runtime.promptSection.indexOf("# Shared") < runtime.promptSection.indexOf("# Review"));
    assert.ok(runtime.promptSection.indexOf("# Review") < runtime.promptSection.indexOf("# Fix"));

    const blocked = registry.setEnabled("shared", false);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, "skill-required-by-enabled-skill");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("install rejects a dependency cycle before replacing registry state", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-advanced-cycle-"));
  try {
    const registry = createRegistry(temp);
    installSkill(registry, temp, {
      id: "cycle-a",
      dependencies: [{ id: "cycle-b", version: "*" }]
    });
    const sourceB = path.join(temp, "source-cycle-b");
    writeSkill(sourceB, {
      id: "cycle-b",
      dependencies: [{ id: "cycle-a", version: "*" }]
    });
    const result = registry.installFromDirectory(sourceB);
    assert.equal(result.ok, false);
    assert.equal(result.code, "skill-dependency-cycle");
    assert.equal(registry.get("cycle-b"), null);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});


test("Skill command and router provenance survive checkpoint continuation", () => {
  const checkpoint = createRunCheckpoint({
    taskId: "skill-task",
    runId: "skill-run",
    skillIds: ["debug"],
    skillSnapshots: [{ id: "debug", name: "Debug", version: "1.0.0" }],
    skillRoutingMode: "auto",
    skillSource: "router",
    skillRouter: {
      matched: true,
      selected: { id: "debug", name: "Debug", score: 10, reasons: ["关键词：debug"] }
    }
  });
  assert.equal(checkpoint.version, 5);
  assert.equal(checkpoint.skillSource, "router");

  const continuation = createCheckpointContinuationState({
    checkpoint,
    messageId: "assistant-message"
  });
  assert.equal(continuation.skillSource, "router");
  assert.equal(continuation.skillRouter.selected.id, "debug");
  assert.deepEqual(continuation.skillIds, ["debug"]);

  const activity = sanitizeActivity({
    taskId: "skill-task",
    runId: "skill-run",
    status: "running",
    checkpoint,
    events: []
  });
  assert.equal(activity.checkpoint.version, 5);
  assert.equal(activity.checkpoint.skillSource, "router");
});
