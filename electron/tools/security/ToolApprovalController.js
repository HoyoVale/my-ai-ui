import crypto from "node:crypto";

import {
  redactSensitiveValue
} from "../core/redaction.js";

const UNSAFE_EFFECTS = new Set([
  "local_write",
  "remote_write",
  "destructive"
]);

const APPROVAL_DECISIONS = new Set([
  "allow_once",
  "allow_run",
  "deny"
]);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function boundedString(value, maxLength = 800) {
  const text = String(value ?? "");
  return text.length > maxLength
    ? `${text.slice(0, Math.max(0, maxLength - 1))}…`
    : text;
}

function boundedApprovalValue(value, state, depth = 0) {
  if (state.items >= 120 || depth > 8) {
    state.truncated = true;
    return "[TRUNCATED]";
  }

  state.items += 1;

  if (typeof value === "string") {
    return boundedString(value, 1200);
  }
  if (value === null || ["number", "boolean"].includes(typeof value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 32).map((item) =>
      boundedApprovalValue(item, state, depth + 1)
    );
  }
  if (!value || typeof value !== "object") {
    return boundedString(value, 240);
  }

  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 64)) {
    output[boundedString(key, 120)] = boundedApprovalValue(
      item,
      state,
      depth + 1
    );
  }
  return output;
}

function publicInput(value) {
  const state = { items: 0, truncated: false };
  const redacted = redactSensitiveValue(value ?? {});
  const input = boundedApprovalValue(redacted, state);
  try {
    const serialized = JSON.stringify(input);
    if (Buffer.byteLength(serialized, "utf8") > 24_000) {
      return {
        input: {
          preview: boundedString(serialized, 12_000),
          note: "参数预览超过安全上限，已截断。"
        },
        inputTruncated: true
      };
    }
  } catch {
    return {
      input: { note: "参数无法安全预览。" },
      inputTruncated: true
    };
  }
  return {
    input,
    inputTruncated: state.truncated
  };
}

function normalizedSecuritySettings(settings = {}) {
  const approval = settings.tools?.security?.approval ?? {};
  const untrusted = settings.tools?.security?.untrustedContent ?? {};
  return {
    approval: {
      localWrite: approval.localWrite !== false,
      remoteWrite: approval.remoteWrite !== false,
      allowRunGrant: approval.allowRunGrant !== false,
      timeoutMs: Math.min(
        30 * 60 * 1000,
        Math.max(30_000, Number(approval.timeoutMs) || 300_000)
      )
    },
    untrustedContent: {
      requirePerCallApproval: untrusted.requirePerCallApproval !== false,
      blockDestructive: untrusted.blockDestructive !== false
    }
  };
}

function approvalReason(effect, definition, tainted, capabilityDecision = null) {
  if (tainted) {
    return "此前 MCP 返回内容包含疑似提示词注入信号，此操作必须由你逐次确认。";
  }
  if (capabilityDecision?.requiresApproval) {
    const permissions = Array.isArray(capabilityDecision.approvalPermissions)
      ? capabilityDecision.approvalPermissions.join("、")
      : "受限能力";
    return `当前 Skill 将此操作的 ${permissions || "权限"} 设为询问。`;
  }
  if (effect === "destructive") {
    return "此工具可能执行破坏性操作，必须由你确认。";
  }
  if (effect === "local_write") {
    return "此工具将修改授权工作区中的文件。";
  }
  if (String(definition?.source ?? "").startsWith("mcp.")) {
    return "此 MCP 工具可能修改外部系统或账户数据。";
  }
  return "此工具可能修改外部系统或发送数据。";
}

function grantKey(definition, effect) {
  return `${definition?.id ?? definition?.name ?? "tool"}:${effect}`;
}

function securitySignalsFromRecord(record = {}) {
  const safety = record?.output?.safety ?? record?.result?.data?.safety ?? null;
  if (!safety || typeof safety !== "object") {
    return null;
  }
  const signals = Array.isArray(safety.promptInjectionSignals)
    ? safety.promptInjectionSignals.map((item) => boundedString(item, 120)).slice(0, 8)
    : [];
  return {
    untrusted: safety.untrusted === true,
    classification: boundedString(safety.classification, 80),
    signals,
    suspicious:
      safety.classification === "prompt-injection-suspected" ||
      signals.length > 0,
    contentTruncated:
      safety.contentTruncated === true || safety.structuredTruncated === true,
    binaryBlocksOmitted: Math.max(0, Number(safety.binaryBlocksOmitted) || 0)
  };
}

export class ToolApprovalController {
  constructor({
    runId = "",
    taskId = "",
    settings = {},
    abortSignal = null,
    onChange = null,
    onResolved = null
  } = {}) {
    this.runId = String(runId ?? "");
    this.taskId = String(taskId ?? "");
    this.settings = normalizedSecuritySettings(settings);
    this.abortSignal = abortSignal;
    this.onChange = typeof onChange === "function" ? onChange : null;
    this.onResolved = typeof onResolved === "function" ? onResolved : null;
    this.queue = [];
    this.grants = new Set();
    this.securityState = {
      untrustedResults: 0,
      suspiciousResults: 0,
      promptInjectionSuspected: false,
      lastSource: "",
      lastToolName: "",
      lastSignals: [],
      lastDetectedAt: null
    };
    this.closed = false;
    this.onAbort = () => {
      this.cancelAll("任务已停止，待批准的工具调用已取消。", "APPROVAL_CANCELLED");
    };

    if (abortSignal?.aborted) {
      this.onAbort();
    } else {
      abortSignal?.addEventListener("abort", this.onAbort, { once: true });
    }
  }

  markToolRecord(record = {}) {
    if (
      !["completed", "failed"].includes(String(record.status ?? "")) ||
      !String(record.source ?? "").startsWith("mcp.")
    ) {
      return this.securitySnapshot();
    }

    const safety = securitySignalsFromRecord(record);
    if (!safety?.untrusted) {
      return this.securitySnapshot();
    }

    this.securityState.untrustedResults += 1;
    this.securityState.lastSource = String(record.source ?? "");
    this.securityState.lastToolName = String(record.name ?? "");

    if (safety.suspicious) {
      this.securityState.suspiciousResults += 1;
      this.securityState.promptInjectionSuspected = true;
      this.securityState.lastSignals = safety.signals;
      this.securityState.lastDetectedAt = Date.now();
      // Any previous convenience grant is invalid after suspicious external
      // content enters the run. Pending requests are upgraded in place so an
      // approval opened before detection cannot retain a run-wide grant.
      this.grants.clear();
      const blockedApprovalIds = [];
      for (const entry of this.queue) {
        entry.tainted = true;
        entry.publicRequest.untrustedContent = true;
        entry.publicRequest.allowRunGrant = false;
        entry.publicRequest.reason =
          "MCP 返回内容包含疑似提示词注入信号，此操作必须由你逐次确认。";
        entry.publicRequest.security = this.securitySnapshot();
        if (
          entry.effect === "destructive" &&
          this.settings.untrustedContent.blockDestructive
        ) {
          blockedApprovalIds.push(entry.id);
        }
      }
      for (const approvalId of blockedApprovalIds) {
        this.settle(approvalId, "deny", {
          code: "UNTRUSTED_DESTRUCTIVE_TOOL_BLOCKED",
          message:
            "检测到疑似提示词注入后，破坏性工具已被安全策略阻止。"
        });
      }
      if (blockedApprovalIds.length === 0) {
        this.emitChange();
      }
    }

    return this.securitySnapshot();
  }

  securitySnapshot() {
    return clone(this.securityState);
  }

  approvalSnapshot() {
    const current = this.queue[0]?.publicRequest ?? null;
    return current
      ? {
          ...clone(current),
          queuedCount: this.queue.length
        }
      : null;
  }

  async authorize(request = {}) {
    if (this.closed || this.abortSignal?.aborted) {
      return {
        decision: "deny",
        code: "APPROVAL_CANCELLED",
        message: "任务已停止，工具调用未执行。"
      };
    }

    const definition = request.definition ?? {};
    const effect = String(
      definition.runtimeContract?.effect ??
      (definition.sideEffect === "write" ? "local_write" : "read")
    );
    const capabilityDecision =
      request.capabilityDecision && typeof request.capabilityDecision === "object"
        ? request.capabilityDecision
        : null;
    const capabilityRequiresApproval =
      capabilityDecision?.requiresApproval === true;

    if (!UNSAFE_EFFECTS.has(effect) && !capabilityRequiresApproval) {
      return { decision: "allow" };
    }

    const tainted = this.securityState.promptInjectionSuspected === true;
    if (
      tainted &&
      effect === "destructive" &&
      this.settings.untrustedContent.blockDestructive
    ) {
      return {
        decision: "deny",
        code: "UNTRUSTED_DESTRUCTIVE_TOOL_BLOCKED",
        message:
          "检测到疑似提示词注入后，破坏性工具已被安全策略阻止。请开始新任务或先核验外部内容。",
        details: {
          security: this.securitySnapshot()
        }
      };
    }

    const configuredApproval = capabilityRequiresApproval
      ? true
      : effect === "local_write"
        ? this.settings.approval.localWrite
        : effect === "destructive"
          ? true
          : this.settings.approval.remoteWrite;
    const requireBecauseTainted =
      tainted && this.settings.untrustedContent.requirePerCallApproval;
    const key = grantKey(definition, effect);

    if (!configuredApproval && !requireBecauseTainted) {
      return { decision: "allow" };
    }
    if (!requireBecauseTainted && effect !== "destructive" && this.grants.has(key)) {
      return { decision: "allow" };
    }

    return this.requestApproval(request, {
      effect,
      tainted,
      key,
      capabilityDecision
    });
  }

  requestApproval(request, { effect, tainted, key, capabilityDecision = null }) {
    const definition = request.definition ?? {};
    const approvalId = crypto.randomUUID();
    const requestedAt = Date.now();
    const timeoutMs = this.settings.approval.timeoutMs;
    const allowRunGrant =
      this.settings.approval.allowRunGrant &&
      effect !== "destructive" &&
      !tainted;
    const { input, inputTruncated } = publicInput(request.input);
    const publicRequest = {
      id: approvalId,
      runId: this.runId,
      taskId: this.taskId,
      callId: String(request.callId ?? ""),
      toolId: String(definition.id ?? ""),
      toolName: String(definition.name ?? ""),
      title: boundedString(definition.title ?? definition.name ?? "工具调用", 160),
      source: boundedString(definition.source ?? "builtin", 160),
      riskLevel: String(definition.riskLevel ?? "medium"),
      effect,
      reason: approvalReason(effect, definition, tainted, capabilityDecision),
      input,
      inputTruncated,
      allowRunGrant,
      untrustedContent: tainted,
      security: tainted ? this.securitySnapshot() : null,
      capabilityApproval: capabilityDecision?.requiresApproval === true,
      approvalPermissions: [
        ...(capabilityDecision?.approvalPermissions ?? [])
      ],
      requestedAt,
      expiresAt: requestedAt + timeoutMs
    };

    return new Promise((resolve) => {
      const entry = {
        id: approvalId,
        key,
        effect,
        tainted,
        publicRequest,
        resolve,
        timeoutId: setTimeout(() => {
          this.settle(approvalId, "deny", {
            code: "APPROVAL_TIMEOUT",
            message: "等待批准超时，工具调用未执行。"
          });
        }, timeoutMs)
      };
      entry.timeoutId.unref?.();
      this.queue.push(entry);
      this.emitChange();
    });
  }

  resolveApproval({ approvalId, decision } = {}) {
    const normalizedId = String(approvalId ?? "");
    const normalizedDecision = String(decision ?? "");
    const active = this.queue[0];

    if (!active || active.id !== normalizedId) {
      return {
        ok: false,
        code: "approval-not-found",
        message: "该批准请求已过期或不再是当前请求。",
        pendingApproval: this.approvalSnapshot()
      };
    }
    if (!APPROVAL_DECISIONS.has(normalizedDecision)) {
      return {
        ok: false,
        code: "invalid-approval-decision",
        message: "不支持的批准操作。",
        pendingApproval: this.approvalSnapshot()
      };
    }

    const effectiveDecision =
      normalizedDecision === "allow_run" && !active.publicRequest.allowRunGrant
        ? "allow_once"
        : normalizedDecision;
    this.settle(normalizedId, effectiveDecision);
    return {
      ok: true,
      decision: effectiveDecision,
      pendingApproval: this.approvalSnapshot()
    };
  }

  settle(approvalId, decision, override = {}) {
    const index = this.queue.findIndex((entry) => entry.id === approvalId);
    if (index < 0) return false;
    const [entry] = this.queue.splice(index, 1);
    clearTimeout(entry.timeoutId);

    const queuedGrantIds = [];
    if (decision === "allow_run") {
      this.grants.add(entry.key);
      for (const queued of this.queue) {
        if (
          queued.key === entry.key &&
          queued.effect !== "destructive" &&
          !queued.tainted
        ) {
          queuedGrantIds.push(queued.id);
        }
      }
    }

    const allowed = decision === "allow_once" || decision === "allow_run";
    const result = allowed
      ? { decision: "allow" }
      : {
          decision: "deny",
          code: String(override.code ?? "TOOL_APPROVAL_DENIED"),
          message: String(override.message ?? "用户拒绝了该工具调用。"),
          details: {
            approvalId: entry.id,
            userDecision: decision
          }
        };

    entry.resolve(result);
    this.onResolved?.({
      request: clone(entry.publicRequest),
      decision,
      result: clone(result)
    });
    for (const queuedId of queuedGrantIds) {
      this.settle(queuedId, "allow_once");
    }
    this.emitChange();
    return true;
  }

  cancelAll(message = "待批准的工具调用已取消。", code = "APPROVAL_CANCELLED") {
    if (this.queue.length === 0) return;
    const pending = [...this.queue];
    this.queue = [];
    for (const entry of pending) {
      clearTimeout(entry.timeoutId);
      const result = {
        decision: "deny",
        code,
        message,
        details: { approvalId: entry.id }
      };
      entry.resolve(result);
      this.onResolved?.({
        request: clone(entry.publicRequest),
        decision: "deny",
        result: clone(result)
      });
    }
    this.emitChange();
  }

  emitChange() {
    this.onChange?.({
      pendingApproval: this.approvalSnapshot(),
      security: this.securitySnapshot()
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.abortSignal?.removeEventListener("abort", this.onAbort);
    this.cancelAll("任务已结束，待批准的工具调用已取消。", "APPROVAL_CANCELLED");
  }
}
