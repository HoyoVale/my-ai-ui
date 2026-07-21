import {
  getToolManifestSnapshot
} from "../tools/manifest/ToolManifestService.js";

import {
  resolveSkillRuntime
} from "./SkillRuntime.js";

function testResult(id, title, passed, details = {}) {
  return {
    id,
    title,
    status: passed ? "passed" : "failed",
    ...details
  };
}

function failureReport({
  skillId,
  mode,
  code,
  message
}) {
  return {
    ok: false,
    code,
    message,
    report: {
      skillId: String(skillId ?? ""),
      mode,
      selectedToolNames: [],
      supportToolNames: [],
      missingRequired: [],
      unavailableOptional: [],
      passed: 0,
      failed: 1,
      tests: [testResult("runtime-resolution", "Runtime 解析", false, {
        message
      })]
    }
  };
}

export function runSkillRuntimeTests({
  registry,
  skillId,
  settings,
  conversation = null
} = {}) {
  const configuredMode = conversation?.mode === "coding" ? "coding" : "chat";
  const normalizedSkillId = String(skillId ?? "").trim();
  if (!normalizedSkillId) {
    return failureReport({
      skillId,
      mode: configuredMode,
      code: "skill-required",
      message: "请选择要检查的 Skill。"
    });
  }

  const runtime = resolveSkillRuntime({
    registry,
    skillId: normalizedSkillId,
    mode: configuredMode
  });

  if (!runtime.ok || !runtime.active || !runtime.skill) {
    return failureReport({
      skillId: normalizedSkillId,
      mode: configuredMode,
      code: runtime.code ?? "skill-runtime-inactive",
      message: runtime.message ?? "Skill Runtime 未激活。"
    });
  }

  const promptBytes = Buffer.byteLength(runtime.prompt ?? "", "utf8");
  const tests = [
    testResult("runtime-resolution", "Runtime 解析", true),
    testResult("dependency-resolution", "Skill 依赖可解析", true, {
      dependencies: runtime.dependencySkills.map((skill) => `${skill.id}@${skill.version}`)
    }),
    testResult("prompt-stack", "Skill Prompt 可加载", Boolean(runtime.promptSection), {
      promptBytes
    })
  ];

  const manifest = getToolManifestSnapshot({
    settings,
    executionContext: {
      conversationId: conversation?.id ?? `skill-test:${runtime.skill.id}`,
      mode: configuredMode,
      workspaceId: conversation?.workspaceId ?? null,
      workspaceAvailable: Boolean(conversation?.workspaceId)
    },
    capabilityRequest: runtime.capabilityRequest
  });
  const resolution = manifest.capabilityResolution;
  const capabilitiesPassed = resolution.missingRequired.length === 0;

  tests.push(testResult(
    "required-capabilities",
    "必需 Capability 可解析",
    capabilitiesPassed,
    {
      missingRequired: [...resolution.missingRequired],
      selectedToolNames: [...resolution.selectedToolNames]
    }
  ));
  tests.push(testResult(
    "permission-intersection",
    "权限求交集",
    Boolean(resolution.permissions?.effective),
    {
      effectivePermissions: resolution.permissions?.effective ?? {}
    }
  ));

  const failed = tests.filter((item) => item.status === "failed").length;
  return {
    ok: failed === 0,
    code: failed === 0 ? "skill-tests-passed" : "skill-tests-failed",
    message: failed === 0 ? "Skill Runtime 检查通过。" : "Skill Runtime 检查发现问题。",
    report: {
      skillId: runtime.skill.id,
      skillIds: [...runtime.rootSkillIds],
      skillName: runtime.rootSkills.map((skill) => skill.name).join(" + "),
      dependencySkillIds: runtime.dependencySkills.map((skill) => skill.id),
      source: runtime.source,
      skillVersion: runtime.skill.version,
      mode: configuredMode,
      promptBytes,
      manifestRevision: manifest.manifestRevision,
      manifestHash: manifest.manifestHash,
      selectedToolNames: [...resolution.selectedToolNames],
      supportToolNames: [...(resolution.supportToolNames ?? [])],
      missingRequired: [...resolution.missingRequired],
      unavailableOptional: [...resolution.unavailableOptional],
      effectivePermissions: resolution.permissions?.effective ?? {},
      passed: tests.length - failed,
      failed,
      tests
    }
  };
}
