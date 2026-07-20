import crypto from "node:crypto";
import path from "node:path";

import {
  requiresManualConfirmation,
  requiresReconciliation
} from "../core/ToolRuntimeContract.js";

import {
  TOOL_CALL_STATES,
  assertToolCallTransition
} from "./ToolCallStateMachine.js";

import {
  DurableRuntimeJournal
} from "./DurableRuntimeJournal.js";

import {
  ToolReceiptStore
} from "./ToolReceiptStore.js";

import {
  ToolLeaseStore
} from "./ToolLeaseStore.js";

import {
  RuntimeCheckpointStore
} from "./RuntimeCheckpointStore.js";

function clone(value) {
  return structuredClone(value);
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function hash(value) {
  return crypto
    .createHash("sha256")
    .update(String(value ?? ""))
    .digest("hex");
}


function runtimeContractSnapshot(contract = {}) {
  return {
    effect: String(contract.effect ?? "read"),
    retryMode: String(contract.retryMode ?? "safe"),
    supportsAbort: contract.supportsAbort === true,
    supportsResume: contract.supportsResume === true,
    timeoutMs: Math.max(0, Number(contract.timeoutMs) || 0),
    leaseTtlMs: Math.max(5_000, Number(contract.leaseTtlMs) || 60_000),
    heartbeatMs: Math.max(1_000, Number(contract.heartbeatMs) || 10_000),
    canReconcile: contract.canReconcile === true || typeof contract.reconcile === "function",
    canVerify: contract.canVerify === true || typeof contract.verify === "function",
    canCompensate: contract.canCompensate === true || typeof contract.compensate === "function"
  };
}

function stateForEvent(type) {
  return {
    TOOL_PLANNED: TOOL_CALL_STATES.PLANNED,
    TOOL_PREPARED: TOOL_CALL_STATES.PREPARED,
    TOOL_DISPATCHED: TOOL_CALL_STATES.DISPATCHED,
    TOOL_EFFECT_CONFIRMED: TOOL_CALL_STATES.EFFECT_CONFIRMED,
    TOOL_RECEIPT_STORED: TOOL_CALL_STATES.RECEIPT_STORED,
    TOOL_REPORTED: TOOL_CALL_STATES.REPORTED,
    TOOL_FAILED: TOOL_CALL_STATES.FAILED,
    TOOL_CANCEL_REQUESTED: TOOL_CALL_STATES.CANCEL_REQUESTED,
    TOOL_CANCELLED: TOOL_CALL_STATES.CANCELLED,
    TOOL_UNKNOWN: TOOL_CALL_STATES.UNKNOWN,
    TOOL_RECONCILIATION_REQUIRED: TOOL_CALL_STATES.NEEDS_RECONCILIATION,
    TOOL_CONFIRMATION_REQUIRED: TOOL_CALL_STATES.NEEDS_CONFIRMATION
  }[type] ?? "";
}

function publicStatusForState(state) {
  if ([
    TOOL_CALL_STATES.PLANNED,
    TOOL_CALL_STATES.PREPARED
  ].includes(state)) {
    return "queued";
  }
  if ([
    TOOL_CALL_STATES.DISPATCHED,
    TOOL_CALL_STATES.EFFECT_CONFIRMED,
    TOOL_CALL_STATES.CANCEL_REQUESTED
  ].includes(state)) {
    return "running";
  }
  if (state === TOOL_CALL_STATES.REPORTED || state === TOOL_CALL_STATES.RECEIPT_STORED) {
    return "completed";
  }
  if (state === TOOL_CALL_STATES.CANCELLED) {
    return "cancelled";
  }
  if ([
    TOOL_CALL_STATES.UNKNOWN,
    TOOL_CALL_STATES.NEEDS_RECONCILIATION,
    TOOL_CALL_STATES.NEEDS_CONFIRMATION
  ].includes(state)) {
    return "attention";
  }
  return "failed";
}

function recoveryActions(call) {
  const recovery = call?.recovery ?? "none";
  if (recovery === "needs_reconciliation") {
    return [
      "recheck",
      "confirm_applied",
      "confirm_not_applied",
      "abandon"
    ];
  }
  if (recovery === "needs_confirmation") {
    return [
      ...(call?.canReconcile ? ["recheck"] : []),
      "confirm_applied",
      "confirm_not_applied",
      "abandon"
    ];
  }
  return [];
}

export class ToolExecutionLedger {
  constructor({
    directory = "",
    taskId = "",
    runId = "",
    workspaceId = "",
    ownerId = "",
    durable = true
  } = {}) {
    this.directory = String(directory ?? "").trim();
    this.taskId = String(taskId ?? "");
    this.runId = String(runId ?? "");
    this.workspaceId = String(workspaceId ?? "");
    this.ownerId = String(ownerId ?? "") || crypto.randomUUID();
    this.calls = new Map();
    this.journal = new DurableRuntimeJournal({
      storageFile: this.directory
        ? path.join(this.directory, "runtime-journal.jsonl")
        : "",
      taskId: this.taskId,
      runId: this.runId,
      workspaceId: this.workspaceId,
      durable
    });
    this.receipts = new ToolReceiptStore({
      directory: this.directory,
      taskId: this.taskId,
      workspaceId: this.workspaceId
    });
    this.leases = new ToolLeaseStore({
      directory: this.directory,
      ownerId: this.ownerId
    });
    this.checkpoints = new RuntimeCheckpointStore({
      directory: this.directory,
      taskId: this.taskId,
      workspaceId: this.workspaceId
    });
    this.rebuild();
  }

  rebuild() {
    this.calls.clear();

    for (const event of this.journal.list()) {
      if (!event.callId) {
        continue;
      }
      const current = this.calls.get(event.callId) ?? {
        callId: event.callId,
        state: "",
        history: []
      };
      const nextState = stateForEvent(event.type);
      current.history.push(event);
      current.latestEvent = event;
      current.state = nextState || current.state;
      current.idempotencyKey = String(
        event.payload?.idempotencyKey ?? current.idempotencyKey ?? ""
      );
      current.toolName = String(
        event.payload?.toolName ?? current.toolName ?? ""
      );
      current.toolId = String(
        event.payload?.toolId ?? current.toolId ?? ""
      );
      current.segmentId = String(
        event.segmentId ?? current.segmentId ?? ""
      );
      current.contract = event.payload?.contract ?? current.contract ?? null;
      current.input = event.payload?.input ?? current.input;
      current.attempt = Math.max(
        Number(current.attempt) || 0,
        Number(event.payload?.attempt) || 0
      );
      current.receiptId = String(
        event.payload?.receiptId ?? current.receiptId ?? ""
      );
      this.calls.set(event.callId, current);
    }
  }

  recordRuntimeEvent(type, payload = {}, options = {}) {
    return this.journal.append(type, payload, {
      runId: options.runId ?? this.runId,
      segmentId: options.segmentId ?? "",
      callId: options.callId ?? ""
    });
  }

  async storeCheckpoint(checkpoint, options = {}) {
    const stored = await this.checkpoints.store(checkpoint);
    await this.recordRuntimeEvent(
      "CHECKPOINT_STORED",
      {
        checkpointVersion: stored.version ?? 1,
        phase: stored.phase ?? "",
        outcome: stored.outcome ?? "",
        resumable: stored.resumable === true,
        unresolvedTools:
          stored.toolRuntime?.unresolvedCount ?? 0,
        updatedAt: stored.updatedAt ?? stored.persistedAt
      },
      {
        runId: options.runId ?? stored.runId ?? this.runId,
        segmentId: options.segmentId ?? ""
      }
    );
    return stored;
  }

  loadCheckpoint() {
    return this.checkpoints.load();
  }

  makeIdempotencyKey({ definition, input, explicitKey = "" }) {
    const explicit = String(explicitKey ?? "").trim();
    if (explicit) {
      return explicit;
    }

    const contract = definition.runtimeContract ?? {};
    if (contract.retryMode !== "idempotency_key") {
      return "";
    }

    if (definition.idempotency === "required") {
      return "";
    }

    return `tool:${hash(canonicalJson({
      taskId: this.taskId,
      toolId: definition.id ?? definition.name,
      input
    }))}`;
  }

  findReceipt(callId, idempotencyKey) {
    return this.receipts.load(callId) ??
      (idempotencyKey
        ? this.receipts.loadByIdempotencyKey(idempotencyKey)
        : null);
  }

  unresolvedByIdempotencyKey(idempotencyKey) {
    if (!idempotencyKey) {
      return null;
    }

    return [...this.calls.values()]
      .reverse()
      .find((call) =>
        call.idempotencyKey === idempotencyKey &&
        ![
          TOOL_CALL_STATES.REPORTED,
          TOOL_CALL_STATES.RECEIPT_STORED,
          TOOL_CALL_STATES.FAILED,
          TOOL_CALL_STATES.CANCELLED
        ].includes(call.state)
      ) ?? null;
  }

  async transition(call, type, payload = {}) {
    const nextState = stateForEvent(type);
    if (nextState) {
      assertToolCallTransition(call.state, nextState);
    }

    const event = await this.journal.append(type, {
      callId: call.callId,
      toolId: call.toolId,
      toolName: call.toolName,
      idempotencyKey: call.idempotencyKey,
      attempt: call.attempt,
      contract: call.contract,
      ...payload
    }, {
      callId: call.callId,
      runId: call.runId,
      segmentId: call.segmentId
    });

    call.state = nextState || call.state;
    call.latestEvent = event;
    call.history = [...(call.history ?? []), event];
    if (payload.receiptId) {
      call.receiptId = String(payload.receiptId);
    }
    this.calls.set(call.callId, call);
    return clone(event);
  }

  async prepare({
    definition,
    input,
    callId,
    segmentId = "",
    explicitIdempotencyKey = "",
    attempt = 1
  }) {
    const id = String(callId ?? "").trim();
    const contract = runtimeContractSnapshot(
      definition.runtimeContract ?? {}
    );
    const idempotencyKey = this.makeIdempotencyKey({
      definition,
      input,
      explicitKey: explicitIdempotencyKey
    });
    const receipt = this.findReceipt(id, idempotencyKey);

    if (receipt) {
      return {
        ok: true,
        replayed: true,
        receipt,
        call: {
          callId: id,
          state: TOOL_CALL_STATES.RECEIPT_STORED,
          toolId: definition.id ?? definition.name,
          toolName: definition.name,
          runId: this.runId,
          segmentId,
          idempotencyKey,
          contract,
          attempt: receipt.attempt ?? attempt
        }
      };
    }

    const unresolved = this.unresolvedByIdempotencyKey(idempotencyKey);
    if (unresolved) {
      if (requiresReconciliation(contract)) {
        return {
          ok: false,
          code: "TOOL_RECONCILIATION_REQUIRED",
          state: TOOL_CALL_STATES.NEEDS_RECONCILIATION,
          previousCall: clone(unresolved)
        };
      }
      if (requiresManualConfirmation(contract)) {
        return {
          ok: false,
          code: "TOOL_CONFIRMATION_REQUIRED",
          state: TOOL_CALL_STATES.NEEDS_CONFIRMATION,
          previousCall: clone(unresolved)
        };
      }
    }

    const existing = this.calls.get(id);
    if (existing && [
      TOOL_CALL_STATES.NEEDS_RECONCILIATION,
      TOOL_CALL_STATES.NEEDS_CONFIRMATION,
      TOOL_CALL_STATES.UNKNOWN
    ].includes(existing.state)) {
      return {
        ok: false,
        code: existing.state === TOOL_CALL_STATES.NEEDS_CONFIRMATION
          ? "TOOL_CONFIRMATION_REQUIRED"
          : "TOOL_RECONCILIATION_REQUIRED",
        state: existing.state,
        previousCall: clone(existing)
      };
    }

    const call = existing ?? {
      callId: id,
      state: TOOL_CALL_STATES.PLANNED,
      history: [],
      toolId: definition.id ?? definition.name,
      toolName: definition.name,
      runId: this.runId,
      segmentId: String(segmentId ?? ""),
      idempotencyKey,
      contract,
      attempt: Math.max(1, Number(attempt) || 1)
    };
    call.segmentId = String(segmentId ?? call.segmentId ?? "");
    call.attempt = Math.max(Number(call.attempt) || 0, Number(attempt) || 1);
    call.contract = contract;
    call.idempotencyKey = idempotencyKey;

    if (!existing) {
      await this.transition(call, "TOOL_PLANNED", {
        inputHash: hash(canonicalJson(input))
      });
    }

    if (call.state === TOOL_CALL_STATES.PLANNED) {
      await this.transition(call, "TOOL_PREPARED", {
        input,
        inputHash: hash(canonicalJson(input))
      });
    }

    const leaseResult = await this.leases.acquire({
      callId: id,
      ttlMs: contract.leaseTtlMs,
      attempt: call.attempt,
      idempotencyKey
    });

    if (!leaseResult.ok) {
      return {
        ok: false,
        code: leaseResult.code,
        state: call.state,
        lease: leaseResult.lease
      };
    }

    call.lease = leaseResult.lease;
    this.calls.set(id, call);
    return { ok: true, replayed: false, call: clone(call) };
  }

  heartbeat(call) {
    const current = this.calls.get(call?.callId) ?? call;
    if (!current?.callId) {
      return Promise.resolve(false);
    }
    return this.leases.heartbeat(
      current.callId,
      current.contract?.leaseTtlMs
    );
  }

  async markDispatched(call, payload = {}) {
    const mutable = this.calls.get(call.callId) ?? clone(call);
    await this.transition(mutable, "TOOL_DISPATCHED", payload);
    return clone(mutable);
  }

  async markEffectConfirmed(call, payload = {}) {
    const mutable = this.calls.get(call.callId) ?? clone(call);
    await this.transition(mutable, "TOOL_EFFECT_CONFIRMED", payload);
    return clone(mutable);
  }

  async storeReceipt(call, receiptInput = {}) {
    const mutable = this.calls.get(call.callId) ?? clone(call);
    const receipt = await this.receipts.store({
      callId: mutable.callId,
      idempotencyKey: mutable.idempotencyKey,
      runId: mutable.runId,
      segmentId: mutable.segmentId,
      toolId: mutable.toolId,
      toolName: mutable.toolName,
      attempt: mutable.attempt,
      ...receiptInput
    });
    await this.transition(mutable, "TOOL_RECEIPT_STORED", {
      receiptId: receipt.receiptId,
      receiptStatus: receipt.status,
      checksum: receipt.checksum
    });
    await this.leases.release(mutable.callId);
    return receipt;
  }

  async markReported(call, receipt = null) {
    const mutable = this.calls.get(call.callId) ?? clone(call);
    if (mutable.state === TOOL_CALL_STATES.RECEIPT_STORED) {
      await this.transition(mutable, "TOOL_REPORTED", {
        receiptId: receipt?.receiptId ?? mutable.receiptId ?? ""
      });
    }
    return clone(mutable);
  }

  async markFailure(call, { error, cancelled = false, status = "error", ...rest } = {}) {
    const mutable = this.calls.get(call.callId) ?? clone(call);
    const receipt = await this.storeReceipt(mutable, {
      status: cancelled ? "cancelled" : status,
      error,
      output: rest.output,
      result: rest.result,
      startedAt: rest.startedAt,
      endedAt: rest.endedAt,
      metadata: rest.metadata
    });
    if (cancelled && mutable.state === TOOL_CALL_STATES.RECEIPT_STORED) {
      // Receipt is authoritative; reported state remains replayable.
      await this.markReported(mutable, receipt);
    }
    return receipt;
  }

  async requestCancellation(call, { reason = "user-stop" } = {}) {
    const mutable = this.calls.get(call.callId) ?? clone(call);
    if (mutable.state === TOOL_CALL_STATES.DISPATCHED) {
      await this.transition(mutable, "TOOL_CANCEL_REQUESTED", { reason });
    }
    return clone(mutable);
  }

  async markUnknown(call, { reason = "", error = null } = {}) {
    const mutable = this.calls.get(call.callId) ?? clone(call);
    const contract = mutable.contract ?? {};
    const type = requiresManualConfirmation(contract)
      ? "TOOL_CONFIRMATION_REQUIRED"
      : requiresReconciliation(contract)
        ? "TOOL_RECONCILIATION_REQUIRED"
        : "TOOL_UNKNOWN";
    await this.transition(mutable, type, { reason, error });
    await this.leases.release(mutable.callId);
    return clone(mutable);
  }

  async reconcile(definitions = [], { callId = "" } = {}) {
    const definitionMap = new Map(
      (Array.isArray(definitions) ? definitions : [])
        .map((definition) => [definition.name, definition])
    );
    const results = [];

    const targetCallId = String(callId ?? "").trim();
    for (const call of [...this.calls.values()]) {
      if (targetCallId && call.callId !== targetCallId) {
        continue;
      }
      const recovery = this.recoverySnapshot().calls.find(
        (item) => item.callId === call.callId
      )?.recovery;

      if (recovery !== "needs_reconciliation") {
        continue;
      }

      const definition = definitionMap.get(call.toolName);
      const reconcile = definition?.runtimeContract?.reconcile;
      if (typeof reconcile !== "function") {
        results.push({
          callId: call.callId,
          status: "unsupported"
        });
        continue;
      }

      let result;
      try {
        result = await reconcile({
          callId: call.callId,
          idempotencyKey: call.idempotencyKey,
          input: clone(call.input),
          taskId: this.taskId,
          runId: call.runId,
          segmentId: call.segmentId,
          workspaceId: this.workspaceId
        });
      } catch (error) {
        results.push({
          callId: call.callId,
          status: "failed",
          error: error instanceof Error ? error.message : String(error)
        });
        continue;
      }

      if (result?.status === "applied") {
        const receipt = await this.storeReceipt(call, {
          status: "success",
          output: result.output ?? { ok: true, data: result.data ?? null },
          result: result.result ?? null,
          startedAt: call.latestEvent?.timestamp ?? 0,
          endedAt: Date.now(),
          metadata: {
            reconciled: true,
            evidence: result.evidence ?? null
          }
        });
        results.push({
          callId: call.callId,
          status: "applied",
          receiptId: receipt.receiptId
        });
        continue;
      }

      if (result?.status === "not_applied") {
        await this.transition(call, "TOOL_PREPARED", {
          reconciliation: "not_applied",
          evidence: result.evidence ?? null
        });
        results.push({
          callId: call.callId,
          status: "not_applied"
        });
        continue;
      }

      await this.transition(call, "TOOL_CONFIRMATION_REQUIRED", {
        reconciliation: "unknown",
        evidence: result?.evidence ?? null
      });
      results.push({
        callId: call.callId,
        status: "needs_confirmation"
      });
    }

    return {
      results,
      recovery: this.publicSnapshot()
    };
  }

  async resolveRecovery({
    callId,
    action,
    definitions = []
  } = {}) {
    const id = String(callId ?? "").trim();
    const requestedAction = String(action ?? "").trim();
    const call = this.calls.get(id);

    if (!call) {
      return {
        ok: false,
        code: "tool-call-not-found",
        message: "找不到需要处理的工具操作。",
        recovery: this.publicSnapshot()
      };
    }

    const current = this.recoverySnapshot().calls.find(
      (item) => item.callId === id
    );
    const allowed = recoveryActions(current);
    if (!allowed.includes(requestedAction)) {
      return {
        ok: false,
        code: "recovery-action-not-allowed",
        message: "当前工具状态不允许执行该恢复操作。",
        recovery: this.publicSnapshot()
      };
    }

    await this.recordRuntimeEvent(
      "TOOL_RECOVERY_ACTION_REQUESTED",
      {
        callId: id,
        action: requestedAction,
        previousState: call.state
      },
      { callId: id, runId: call.runId, segmentId: call.segmentId }
    );

    if (requestedAction === "recheck") {
      const result = await this.reconcile(definitions, { callId: id });
      return {
        ok: result.results.some((item) =>
          ["applied", "not_applied"].includes(item.status)
        ),
        action: requestedAction,
        result: result.results[0] ?? null,
        recovery: result.recovery
      };
    }

    if (requestedAction === "confirm_applied") {
      const receipt = await this.storeReceipt(call, {
        status: "success",
        output: {
          ok: true,
          data: {
            manuallyConfirmed: true,
            message: "用户确认该操作已经生效。"
          }
        },
        result: {
          status: "success",
          summary: "用户已确认该操作生效。",
          preview: "",
          truncated: false,
          clipped: false
        },
        startedAt: call.latestEvent?.timestamp ?? 0,
        endedAt: Date.now(),
        metadata: {
          recoveryAction: requestedAction,
          confirmedByUser: true
        }
      });
      await this.markReported(call, receipt);
      await this.recordRuntimeEvent(
        "TOOL_RECOVERY_ACTION_COMPLETED",
        { callId: id, action: requestedAction, receiptId: receipt.receiptId },
        { callId: id, runId: call.runId, segmentId: call.segmentId }
      );
      return {
        ok: true,
        action: requestedAction,
        receiptId: receipt.receiptId,
        recovery: this.publicSnapshot()
      };
    }

    if (requestedAction === "confirm_not_applied") {
      const mutable = this.calls.get(id) ?? clone(call);
      await this.transition(mutable, "TOOL_PREPARED", {
        recoveryAction: requestedAction,
        confirmedByUser: true,
        previousState: call.state
      });
      await this.leases.release(id);
      await this.recordRuntimeEvent(
        "TOOL_RECOVERY_ACTION_COMPLETED",
        { callId: id, action: requestedAction, nextState: "prepared" },
        { callId: id, runId: call.runId, segmentId: call.segmentId }
      );
      return {
        ok: true,
        action: requestedAction,
        retryAllowed: true,
        recovery: this.publicSnapshot()
      };
    }

    const receipt = await this.storeReceipt(call, {
      status: "cancelled",
      output: {
        ok: false,
        error: {
          code: "TOOL_OPERATION_ABANDONED",
          type: "CANCELLED",
          category: "cancelled",
          message: "用户已放弃该工具操作。",
          retryable: false
        }
      },
      result: {
        status: "cancelled",
        summary: "用户已放弃该操作。",
        preview: "",
        truncated: false,
        clipped: false
      },
      startedAt: call.latestEvent?.timestamp ?? 0,
      endedAt: Date.now(),
      metadata: {
        recoveryAction: requestedAction,
        abandonedByUser: true
      }
    });
    await this.markReported(call, receipt);
    await this.recordRuntimeEvent(
      "TOOL_RECOVERY_ACTION_COMPLETED",
      { callId: id, action: requestedAction, receiptId: receipt.receiptId },
      { callId: id, runId: call.runId, segmentId: call.segmentId }
    );
    return {
      ok: true,
      action: requestedAction,
      receiptId: receipt.receiptId,
      recovery: this.publicSnapshot()
    };
  }

  recoverySnapshot() {
    const receipts = new Map(
      this.receipts.list().map((receipt) => [receipt.callId, receipt])
    );
    const calls = [...this.calls.values()].map((call) => {
      const receipt = receipts.get(call.callId) ?? null;
      let recovery = "none";

      if (receipt) {
        recovery = "replay_receipt";
      } else if (call.state === TOOL_CALL_STATES.PREPARED) {
        recovery = "safe_to_dispatch";
      } else if ([
        TOOL_CALL_STATES.DISPATCHED,
        TOOL_CALL_STATES.EFFECT_CONFIRMED,
        TOOL_CALL_STATES.CANCEL_REQUESTED,
        TOOL_CALL_STATES.UNKNOWN
      ].includes(call.state)) {
        if (call.contract?.retryMode === "safe") {
          recovery = "safe_to_retry";
        } else if (
          call.contract?.retryMode === "idempotency_key" &&
          call.idempotencyKey
        ) {
          recovery = "retry_with_idempotency_key";
        } else if (requiresManualConfirmation(call.contract)) {
          recovery = "needs_confirmation";
        } else {
          recovery = "needs_reconciliation";
        }
      } else if (call.state === TOOL_CALL_STATES.NEEDS_CONFIRMATION) {
        recovery = "needs_confirmation";
      } else if (call.state === TOOL_CALL_STATES.NEEDS_RECONCILIATION) {
        recovery = "needs_reconciliation";
      }

      return {
        callId: call.callId,
        toolName: call.toolName,
        state: call.state,
        publicStatus: publicStatusForState(call.state),
        recovery,
        effect: call.contract?.effect ?? "read",
        retryMode: call.contract?.retryMode ?? "safe",
        canReconcile: call.contract?.canReconcile === true,
        hasReceipt: Boolean(receipt),
        receiptId: receipt?.receiptId ?? call.receiptId ?? "",
        segmentId: call.segmentId,
        attempt: call.attempt,
        idempotencyKey: call.idempotencyKey,
        latestAt: call.latestEvent?.timestamp ?? 0
      };
    });

    for (const call of calls) {
      call.actions = recoveryActions(call);
    }

    const unresolved = calls.filter((call) => [
      "needs_confirmation",
      "needs_reconciliation"
    ].includes(call.recovery));

    return {
      version: 1,
      taskId: this.taskId,
      runId: this.runId,
      totalCalls: calls.length,
      receiptCount: receipts.size,
      unresolvedCount: unresolved.length,
      needsConfirmation: unresolved.filter(
        (call) => call.recovery === "needs_confirmation"
      ).length,
      needsReconciliation: unresolved.filter(
        (call) => call.recovery === "needs_reconciliation"
      ).length,
      calls
    };
  }

  publicSnapshot() {
    const snapshot = this.recoverySnapshot();
    return {
      version: snapshot.version,
      totalCalls: snapshot.totalCalls,
      unresolvedCount: snapshot.unresolvedCount,
      needsConfirmation: snapshot.needsConfirmation,
      needsReconciliation: snapshot.needsReconciliation,
      calls: snapshot.calls.map((call) => ({
        callId: call.callId,
        toolName: call.toolName,
        state: call.state,
        publicStatus: call.publicStatus,
        recovery: call.recovery,
        effect: call.effect,
        hasReceipt: call.hasReceipt,
        actions: [...(call.actions ?? [])]
      }))
    };
  }

  developerSnapshot() {
    return this.recoverySnapshot();
  }

  async flush() {
    await this.journal.flush();
    return true;
  }

  async close() {
    await this.journal.close();
    return true;
  }
}
