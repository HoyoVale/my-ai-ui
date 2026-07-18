function normalizeDecision(value) {
  if (!value || value.decision === "allow" || value.ok === true) {
    return { decision: "allow" };
  }

  if (value.decision === "require_approval") {
    return {
      decision: "require_approval",
      request: structuredClone(value.request ?? {}),
      code: String(value.code ?? "APPROVAL_REQUIRED"),
      message: String(value.message ?? "该工具调用需要用户批准。")
    };
  }

  return {
    decision: "deny",
    code: String(value.code ?? "POLICY_DENIED"),
    message: String(value.message ?? "工具调用被运行时策略拒绝。"),
    retryable: false,
    details:
      value.details === undefined
        ? undefined
        : structuredClone(value.details)
  };
}

export class ToolPolicyEngine {
  constructor({ authorize = null } = {}) {
    this.authorize =
      typeof authorize === "function"
        ? authorize
        : () => ({ decision: "allow" });
  }

  async evaluate(request) {
    return normalizeDecision(
      await this.authorize(structuredClone(request))
    );
  }
}

export { normalizeDecision as normalizeToolPolicyDecision };
