import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildCompletionEvidence,
  reconcileFinalResponse,
  validateCompletionClaims
} from "../../electron/agent/finalization/CompletionEvidenceGate.js";
import {
  terminalizeActivityEvents,
  hasOpenActivity
} from "../../electron/agent/finalization/ActivityTerminalizer.js";
import {
  RunActivityStore
} from "../../electron/agent/RunActivityStore.js";
import {
  resolveRunOutcome
} from "../../electron/agent/RunOutcomeResolver.js";
import {
  RUN_OUTCOMES
} from "../../electron/agent/RunStateMachine.js";
import {
  RUN_STOP_REASONS
} from "../../electron/agent/runStopReasons.js";
import {
  projectMessageSnapshot,
  sanitizeMessage
} from "../../electron/conversation/conversationSchema.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(
  path.join(here, "../fixtures/truth-consistency-black-hole-water.json"),
  "utf8"
));

function successfulBuild(id = "build-ok") {
  return {
    id,
    name: "run_project_script",
    status: "completed",
    input: { script: "build", cwd: "water-physics" },
    commandPreview: {
      displayCommand: "npm run build",
      exitCode: 0
    },
    result: {
      ok: true,
      data: {
        exitCode: 0,
        displayCommand: "npm run build"
      }
    }
  };
}

describe("Stability P0 truth consistency", () => {
  it("does not authorize completion while a build failure is unresolved", () => {
    const evidence = buildCompletionEvidence({
      records: [fixture.failedBuild]
    });
    assert.equal(evidence.canComplete, false);
    assert.equal(evidence.failures.hasActive, true);
    assert.equal(evidence.commands.build.success, false);

    const resolved = resolveRunOutcome({
      stopReason: RUN_STOP_REASONS.TOOL_ERROR,
      records: [fixture.failedBuild],
      finalText: fixture.unsupportedFinalText
    });
    assert.notEqual(resolved.outcome, RUN_OUTCOMES.COMPLETED);
  });

  it("replaces unsupported success claims with an evidence-backed failure summary", () => {
    const result = reconcileFinalResponse({
      finalText: fixture.unsupportedFinalText,
      records: [fixture.failedBuild],
      outcome: RUN_OUTCOMES.CONTINUABLE,
      stopReason: RUN_STOP_REASONS.TOOL_ERROR
    });
    assert.equal(result.changed, true);
    assert.doesNotMatch(result.text, /构建成功|依赖安装成功|项目已经完成/u);
    assert.match(result.text, /npm run build|Could not resolve vite/u);
    assert.match(result.text, /尚未(?:全部)?完成/u);
  });

  it("accepts a build success claim only after a successful build receipt", () => {
    const evidence = buildCompletionEvidence({
      records: [fixture.failedBuild, successfulBuild()]
    });
    const claims = validateCompletionClaims({
      finalText: "构建成功，项目已经完成。",
      evidence,
      outcome: RUN_OUTCOMES.COMPLETED
    });
    assert.equal(evidence.canComplete, true);
    assert.equal(claims.valid, true);
  });

  it("terminalizes every open activity when a Run ends", () => {
    const events = terminalizeActivityEvents([
      { id: "status", type: "status", status: "running" },
      {
        id: "batch",
        type: "batch",
        status: "running",
        batch: { id: "batch", status: "running", endedAt: null }
      },
      {
        id: "tool",
        type: "tool",
        status: "running",
        tool: { id: "tool", status: "running", endedAt: null }
      }
    ], {
      outcome: RUN_OUTCOMES.CONTINUABLE,
      activityStatus: "checkpoint_ready",
      endedAt: 20
    });
    assert.equal(hasOpenActivity(events), false);
    assert.ok(events.every((event) => event.status !== "running"));
    assert.equal(events.find((event) => event.id === "tool").tool.status, "interrupted");
  });

  it("RunActivityStore never snapshots running Items after finalization", () => {
    const store = new RunActivityStore({
      taskId: "task-1",
      runId: "run-1",
      startedAt: 1
    });
    store.beginBatch("验证项目", 2);
    store.recordProgress({ title: "运行构建", status: "running" }, 3);
    store.finalize(RUN_STOP_REASONS.TOOL_ERROR, 10, {
      status: "checkpoint_ready",
      outcome: RUN_OUTCOMES.CONTINUABLE,
      resumable: true
    });
    const snapshot = store.snapshot();
    assert.equal(hasOpenActivity(snapshot.events), false);
  });

  it("persists delivery completion separately from a failed Run outcome", () => {
    const message = projectMessageSnapshot(sanitizeMessage({
      id: "assistant-1",
      role: "assistant",
      content: "构建验证失败。",
      status: "complete",
      runOutcome: "failed",
      runPhase: "failed",
      runResumable: false,
      activity: {
        version: 3,
        taskId: "task-1",
        runId: "run-1",
        status: "failed",
        outcome: "failed",
        startedAt: 1,
        endedAt: 2,
        durationMs: 1,
        stopReason: "tool_error",
        resumable: false,
        events: []
      },
      createdAt: 2
    }, 2, "assistant-1"));
    assert.equal(message.status, "complete");
    assert.equal(message.metadata.run.outcome, "failed");
    assert.equal(message.metadata.run.phase, "failed");
  });

  it("revalidates a proposed completed outcome at the final authority boundary", () => {
    const source = fs.readFileSync(
      path.join(
        here,
        "../../electron/agent/finalization/AgentRunFinalization.js"
      ),
      "utf8"
    );

    assert.match(
      source,
      /effectiveOutcome === RUN_OUTCOMES\.COMPLETED/u
    );
    assert.match(
      source,
      /const guardedResolution = resolveRunOutcome\(\{/u
    );
    assert.match(
      source,
      /effectiveOutcome = guardedResolution\.outcome;/u
    );
  });
});
