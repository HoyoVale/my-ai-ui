const FAILURE_TYPES = Object.freeze({
  IMPLEMENTATION: "implementation",
  TEST: "test",
  ENVIRONMENT: "environment",
  CONFLICT: "conflict",
  EVIDENCE: "evidence",
  REQUIREMENTS: "requirements"
});

function text(value, limit = 4000) {
  return String(value ?? "").trim().slice(0, limit);
}

function joinedFailureText(input = {}) {
  return [
    input.code,
    input.stage,
    input.message,
    input.error,
    input.stopReason,
    ...(Array.isArray(input.findings) ? input.findings : []),
    ...(Array.isArray(input.conflicts) ? input.conflicts : [])
  ].map((value) => text(value)).filter(Boolean).join("\n");
}

const PATTERNS = Object.freeze({
  requirements: /(?:needs?[-_ ](?:user[-_ ])?input|requirement|ambiguous|clarif|user[-_ ]decision|需求|歧义|澄清|用户输入)/iu,
  conflict: /(?:integration[-_ ]conflict|merge[-_ ]conflict|cherry[-_ ]pick|resource[-_ ]lease[-_ ]conflict|target[-_ ]changed|冲突)/iu,
  evidence: /(?:evidence|verification[-_ ]required|completion[-_ ]unverified|review[-_ ]rejected|review[-_ ]output[-_ ]invalid|证据|审查未通过|验收)/iu,
  test: /(?:^|[\s:_-])(?:test|e2e|playwright|vitest|jest|pytest|lint|build|compile|typecheck|check)(?:$|[\s:_-])|assertionerror|tests? failed|测试|构建|编译|静态检查/iu,
  environment: /(?:enoent|eacces|eperm|enospc|emfile|dbus|display|xvfb|network|fetch failed|timed?out|timeout|socket|port in use|not found|permission|budget[-_ ]exceeded|token[-_ ]limit|step[-_ ]limit|环境|权限|网络|预算|磁盘空间|端口占用)/iu
});

export { FAILURE_TYPES };

export function classifyPlatformFailure(input = {}) {
  const source = joinedFailureText(input);
  let type = FAILURE_TYPES.IMPLEMENTATION;
  if (PATTERNS.requirements.test(source)) type = FAILURE_TYPES.REQUIREMENTS;
  else if (PATTERNS.conflict.test(source)) type = FAILURE_TYPES.CONFLICT;
  else if (PATTERNS.environment.test(source)) type = FAILURE_TYPES.ENVIRONMENT;
  else if (PATTERNS.evidence.test(source)) type = FAILURE_TYPES.EVIDENCE;
  else if (PATTERNS.test.test(source)) type = FAILURE_TYPES.TEST;

  const policy = {
    [FAILURE_TYPES.IMPLEMENTATION]: {
      retryable: true,
      requiresUserInput: false,
      nextRole: "implementer",
      action: "repair-implementation"
    },
    [FAILURE_TYPES.TEST]: {
      retryable: true,
      requiresUserInput: false,
      nextRole: "implementer",
      action: "repair-validation-failure"
    },
    [FAILURE_TYPES.ENVIRONMENT]: {
      retryable: true,
      requiresUserInput: false,
      nextRole: "explorer",
      action: "diagnose-environment"
    },
    [FAILURE_TYPES.CONFLICT]: {
      retryable: false,
      requiresUserInput: false,
      nextRole: "integrator",
      action: "resolve-conflict-explicitly"
    },
    [FAILURE_TYPES.EVIDENCE]: {
      retryable: true,
      requiresUserInput: false,
      nextRole: "tester",
      action: "produce-missing-evidence"
    },
    [FAILURE_TYPES.REQUIREMENTS]: {
      retryable: false,
      requiresUserInput: true,
      nextRole: "planner",
      action: "request-clarification"
    }
  }[type];

  return {
    version: 1,
    type,
    code: text(input.code, 160) || "platform-failure",
    stage: text(input.stage, 120) || "execution",
    summary: text(input.message || input.error || input.code, 1000),
    conflicts: (Array.isArray(input.conflicts) ? input.conflicts : [])
      .map((item) => text(item, 500))
      .filter(Boolean)
      .slice(0, 100),
    retryable: policy.retryable,
    requiresUserInput: policy.requiresUserInput,
    nextRole: policy.nextRole,
    action: policy.action
  };
}
