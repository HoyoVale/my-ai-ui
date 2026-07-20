import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  ToolExecutionLedger
} from "./ToolExecutionLedger.js";

const COMPLETED_RUN_EVENTS = new Set([
  "RUN_COMPLETED",
  "RUN_CANCELLED",
  "RUN_FAILED"
]);

function clone(value) {
  return structuredClone(value);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readRuntimeIdentity(runtimeDirectory, fallbackTaskId) {
  const checkpoint = readJson(path.join(runtimeDirectory, "checkpoint.json"));
  const journalFiles = fs.existsSync(runtimeDirectory)
    ? fs.readdirSync(runtimeDirectory)
        .filter((name) =>
          name === "runtime-journal.jsonl" ||
          /^runtime-journal\.\d{6}\.jsonl$/u.test(name)
        )
        .sort((left, right) => {
          if (left === "runtime-journal.jsonl") return 1;
          if (right === "runtime-journal.jsonl") return -1;
          return left.localeCompare(right);
        })
        .map((name) => path.join(runtimeDirectory, name))
    : [];
  let latest = null;

  for (const journalFile of journalFiles) {
    for (const line of fs.readFileSync(journalFile, "utf8").split("\n")) {
      if (!line.trim()) {
        continue;
      }
      try {
        const event = JSON.parse(line);
        if (
          event &&
          typeof event === "object" &&
          Number(event.sequence ?? 0) >= Number(latest?.sequence ?? -1)
        ) {
          latest = event;
        }
      } catch {
        // A truncated line is handled by DurableRuntimeJournal.
      }
    }
  }

  return {
    taskId: String(
      latest?.taskId ?? checkpoint?.taskId ?? fallbackTaskId ?? ""
    ),
    runId: String(latest?.runId ?? checkpoint?.runId ?? ""),
    workspaceId: String(
      latest?.workspaceId ?? checkpoint?.workspaceId ?? ""
    )
  };
}

function hasRuntimeFiles(directory) {
  return [
    "runtime-journal.jsonl",
    "runtime-journal.manifest.json",
    "checkpoint.json",
    "receipts",
    "leases",
    "call-state"
  ].some((name) => fs.existsSync(path.join(directory, name)));
}

function decisionFromState({ events, checkpoint, recovery }) {
  const latestRunEvent = [...events]
    .reverse()
    .find((event) => event.type.startsWith("RUN_"));
  const latestType = latestRunEvent?.type ?? "";

  if (recovery.needsConfirmation > 0) {
    return {
      phase: "needs_confirmation",
      outcome: "needs_confirmation",
      activityStatus: "needs_confirmation",
      messageStatus: "interrupted",
      stopReason: "needs_confirmation",
      resumable: true,
      title: "有工具操作需要确认",
      applyToConversation: true
    };
  }

  if (recovery.needsReconciliation > 0) {
    return {
      phase: "reconciling",
      outcome: "needs_reconciliation",
      activityStatus: "needs_reconciliation",
      messageStatus: "interrupted",
      stopReason: "needs_reconciliation",
      resumable: true,
      title: "有工具操作需要核验",
      applyToConversation: true
    };
  }

  if (
    COMPLETED_RUN_EVENTS.has(latestType) &&
    !checkpoint?.resumable
  ) {
    const completed = latestType === "RUN_COMPLETED";
    const cancelled = latestType === "RUN_CANCELLED";
    return {
      phase: completed ? "completed" : cancelled ? "cancelled" : "failed",
      outcome: completed ? "completed" : cancelled ? "cancelled" : "failed",
      activityStatus: completed ? "completed" : cancelled ? "cancelled" : "failed",
      messageStatus: cancelled ? "aborted" : "complete",
      stopReason: String(latestRunEvent?.payload?.stopReason ?? ""),
      resumable: false,
      title: completed ? "任务已完成" : cancelled ? "任务已取消" : "任务失败",
      applyToConversation: false
    };
  }

  return {
    phase: "interrupted",
    outcome: "interrupted",
    activityStatus: "interrupted",
    messageStatus: "interrupted",
    stopReason: "interrupted",
    resumable: true,
    title: "执行被中断，可从检查点继续",
    applyToConversation: true
  };
}

export class RuntimeRecoveryManager {
  constructor({
    rootDirectory = "",
    ownerId = ""
  } = {}) {
    this.rootDirectory = String(rootDirectory ?? "").trim();
    this.ownerId = String(ownerId ?? "") || `startup-${crypto.randomUUID()}`;
  }

  runtimeDirectories() {
    if (!this.rootDirectory || !fs.existsSync(this.rootDirectory)) {
      return [];
    }

    const directories = [];
    for (const entry of fs.readdirSync(this.rootDirectory, {
      withFileTypes: true
    })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const taskDirectory = path.join(this.rootDirectory, entry.name);
      const runtimeDirectory = path.join(taskDirectory, "runtime");
      if (hasRuntimeFiles(runtimeDirectory)) {
        directories.push({
          fallbackTaskId: entry.name,
          runtimeDirectory
        });
      }
    }
    return directories;
  }

  async recoverRuntimeDirectory({ runtimeDirectory, fallbackTaskId }) {
    const identity = readRuntimeIdentity(runtimeDirectory, fallbackTaskId);
    const ledger = new ToolExecutionLedger({
      directory: runtimeDirectory,
      taskId: identity.taskId,
      runId: identity.runId,
      workspaceId: identity.workspaceId,
      ownerId: this.ownerId
    });

    try {
      await ledger.leases.clearOrphaned();
      const materialized = await ledger.materializeRecoveryStates();
      const checkpoint = await ledger.recoverCheckpoint();
      const recovery = ledger.publicSnapshot();
      const events = ledger.journal.list();
      const decision = decisionFromState({
        events,
        checkpoint,
        recovery
      });
      const nextCheckpoint = checkpoint
        ? {
            ...checkpoint,
            phase: decision.phase,
            outcome: decision.outcome,
            resumable: decision.resumable,
            publicStatus: decision.messageStatus,
            stopReason: decision.stopReason,
            toolRuntime: recovery,
            ...ledger.recoveryCursor(),
            snapshotSource: checkpoint.snapshotSource || "checkpoint",
            recoveredAt: Date.now(),
            updatedAt: Date.now()
          }
        : null;

      let storedCheckpoint = checkpoint;
      if (nextCheckpoint && decision.applyToConversation) {
        storedCheckpoint = await ledger.storeCheckpoint(nextCheckpoint, {
          runId: identity.runId,
          segmentId: nextCheckpoint.committedSegmentId
        });
      }

      if (decision.applyToConversation) {
        await ledger.recordRuntimeEvent(
          "RUN_RECOVERY_CLASSIFIED",
          {
            phase: decision.phase,
            outcome: decision.outcome,
            unresolvedTools: recovery.unresolvedCount,
            materializedCalls: materialized.length
          },
          {
            runId: identity.runId,
            actor: "recovery-manager",
            reason: "startup_scan",
            durability: "critical"
          }
        );
      }

      return {
        ok: true,
        taskId: identity.taskId,
        runId: identity.runId,
        workspaceId: identity.workspaceId,
        runtimeDirectory,
        recovery,
        checkpoint: storedCheckpoint,
        ...decision
      };
    } finally {
      await ledger.close();
    }
  }

  async recoverAll() {
    const decisions = [];
    const errors = [];

    for (const entry of this.runtimeDirectories()) {
      try {
        decisions.push(await this.recoverRuntimeDirectory(entry));
      } catch (error) {
        errors.push({
          runtimeDirectory: entry.runtimeDirectory,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return {
      ok: errors.length === 0,
      scanned: decisions.length + errors.length,
      recovered: decisions.filter((item) => item.applyToConversation).length,
      decisions: decisions.map(clone),
      byTask: Object.fromEntries(
        decisions
          .filter((item) => item.taskId)
          .map((item) => [item.taskId, clone(item)])
      ),
      errors
    };
  }
}
