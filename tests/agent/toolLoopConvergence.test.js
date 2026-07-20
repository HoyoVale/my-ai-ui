import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  generateText,
  stepCountIs
} from "ai";
import {
  MockLanguageModelV4
} from "ai/test";

import {
  createAgentToolSession
} from "../../electron/tools/createAgentToolSession.js";
import {
  LongTaskOrchestrator
} from "../../electron/agent/orchestration/LongTaskOrchestrator.js";
import {
  ToolApprovalController
} from "../../electron/tools/security/ToolApprovalController.js";
import {
  inferRunStopReason,
  RUN_STOP_REASONS
} from "../../electron/agent/runStopReasons.js";


function usage() {
  return {
    inputTokens: {
      total: 1,
      noCache: 1,
      cacheRead: undefined,
      cacheWrite: undefined
    },
    outputTokens: {
      total: 1,
      text: 1,
      reasoning: undefined
    }
  };
}

function toolCall(toolCallId, toolName, input) {
  return {
    content: [
      {
        type: "tool-call",
        toolCallId,
        toolName,
        input: JSON.stringify(input)
      }
    ],
    finishReason: { unified: "tool-calls", raw: undefined },
    usage: usage(),
    warnings: []
  };
}

function finalText(text) {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: undefined },
    usage: usage(),
    warnings: []
  };
}

describe("AI SDK Tool loop convergence", () => {
  it("executes a Tool and reaches a final model response", async () => {
    const session = createAgentToolSession();
    const model = new MockLanguageModelV4({
      doGenerate: [
        toolCall("calculator-1", "calculator", { expression: "2 + 2" }),
        finalText("The result is 4.")
      ]
    });
    const result = await generateText({
      model,
      tools: session.tools,
      prompt: "Calculate 2 + 2.",
      stopWhen: stepCountIs(4)
    });

    assert.equal(result.text, "The result is 4.");
    assert.equal(model.doGenerateCalls.length, 2);
    assert.equal(session.getRecords()[0].status, "completed");
  });

  it("continues a real Tool loop across two bounded segments", async () => {
    let segmentId = "";
    const session = createAgentToolSession({
      getSegmentId: () => segmentId,
      taskId: "task",
      segmentId: "run"
    });
    const model = new MockLanguageModelV4({
      doGenerate: [
        toolCall("plan-1", "update_plan", {
          items: [
            { id: "calculate", title: "Calculate", status: "in_progress" },
            { id: "answer", title: "Answer", status: "pending" }
          ]
        }),
        toolCall("calculator-1", "calculator", { expression: "20 + 22" }),
        toolCall("plan-2", "update_plan", {
          items: [
            { id: "calculate", title: "Calculate", status: "completed" },
            { id: "answer", title: "Answer", status: "completed" }
          ]
        }),
        finalText("The result is 42.")
      ]
    });
    const orchestrator = new LongTaskOrchestrator({
      goalId: "goal",
      taskId: "task",
      runId: "run",
      maxSegmentSteps: 2,
      maxSegments: 3
    });

    const firstSegment = orchestrator.beginSegment({
      plan: session.getPlan(),
      records: session.getRecords()
    });
    segmentId = firstSegment.id;
    const firstResult = await generateText({
      model,
      tools: session.tools,
      prompt: "Calculate 20 + 22 with a plan.",
      stopWhen: stepCountIs(2)
    });
    firstResult.steps.forEach((step) => orchestrator.recordStep(step));
    const firstPlan = session.getPlan();
    const firstRecords = session.getRecords();
    const firstReason = inferRunStopReason({
      records: firstRecords,
      finishReason: firstResult.finishReason,
      steps: firstResult.steps,
      maxSteps: 2,
      plan: firstPlan
    });
    const firstOutcome = orchestrator.completeSegment({
      stopReason: firstReason,
      finishReason: firstResult.finishReason,
      plan: firstPlan,
      records: firstRecords
    });

    assert.equal(firstReason, RUN_STOP_REASONS.AGENT_STEP_LIMIT);
    assert.equal(firstOutcome.decision, "continue");

    const secondSegment = orchestrator.beginSegment({
      plan: firstPlan,
      records: firstRecords
    });
    segmentId = secondSegment.id;
    const secondResult = await generateText({
      model,
      tools: session.tools,
      prompt: "Continue from the checkpoint and finish the plan.",
      stopWhen: stepCountIs(2)
    });
    secondResult.steps.forEach((step) => orchestrator.recordStep(step));
    const finalPlan = session.getPlan();
    const finalRecords = session.getRecords();
    const finalReason = inferRunStopReason({
      records: finalRecords,
      finishReason: secondResult.finishReason,
      steps: secondResult.steps,
      maxSteps: 2,
      plan: finalPlan
    });
    const finalOutcome = orchestrator.completeSegment({
      stopReason: finalReason,
      finishReason: secondResult.finishReason,
      plan: finalPlan,
      records: finalRecords,
      finalText: secondResult.text
    });

    assert.equal(secondResult.text, "The result is 42.");
    assert.equal(finalReason, RUN_STOP_REASONS.COMPLETED);
    assert.equal(finalOutcome.decision, "complete");
    assert.equal(finalOutcome.snapshot.segmentCount, 2);
    assert.equal(
      finalRecords.find((record) => record.id === "calculator-1")?.segmentId,
      firstSegment.id
    );
    assert.equal(
      finalRecords.find((record) => record.id === "plan-2")?.segmentId,
      secondSegment.id
    );
  });


  it("completes a Coding file write after a real approval round trip", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "xixi-approved-write-")
    );
    const abortController = new AbortController();
    let pendingApproval = null;
    const approvalController = new ToolApprovalController({
      runId: "run-write",
      taskId: "task-write",
      settings: {
        tools: {
          security: {
            approval: {
              localWrite: true,
              remoteWrite: true,
              allowRunGrant: true,
              timeoutMs: 300_000
            },
            untrustedContent: {
              requirePerCallApproval: true,
              blockDestructive: true
            }
          }
        }
      },
      abortSignal: abortController.signal,
      onChange: ({ pendingApproval: next }) => {
        pendingApproval = next;
      }
    });
    const session = createAgentToolSession({
      activeModel: { provider: "deepseek" },
      taskId: "task-write",
      runId: "run-write",
      workspaceId: "workspace-write",
      mode: "coding",
      settings: {
        tools: {
          mode: "coding",
          runtime: {},
          workspace: { roots: [root] },
          security: {
            approval: {
              localWrite: true,
              remoteWrite: true,
              allowRunGrant: true,
              timeoutMs: 300_000
            },
            untrustedContent: {
              requirePerCallApproval: true,
              blockDestructive: true
            }
          },
          developer: {
            toolsetOverrides: {},
            toolOverrides: {}
          }
        }
      },
      authorizeTool: (request) =>
        approvalController.authorize(request)
    });
    const model = new MockLanguageModelV4({
      doGenerate: [
        toolCall("plan-write", "update_plan", {
          items: [
            {
              id: "write",
              title: "Write approved file",
              status: "in_progress"
            }
          ]
        }),
        toolCall("write-file", "write_text_file", {
          path: "approved.txt",
          content: "approved write\n"
        }),
        toolCall("plan-complete", "update_plan", {
          items: [
            {
              id: "write",
              title: "Write approved file",
              status: "completed"
            }
          ]
        }),
        finalText("The approved file was written.")
      ]
    });

    try {
      const execution = generateText({
        model,
        tools: session.tools,
        prompt: "Write approved.txt after user approval.",
        stopWhen: stepCountIs(8)
      });

      for (let index = 0; index < 50 && !pendingApproval; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      assert.ok(pendingApproval, "the file write should wait for approval");
      assert.equal(pendingApproval.toolName, "write_text_file");
      assert.equal(
        fs.existsSync(path.join(root, "approved.txt")),
        false,
        "the side effect must not happen before approval"
      );

      const resolved = approvalController.resolveApproval({
        approvalId: pendingApproval.id,
        decision: "allow_once"
      });
      assert.equal(resolved.ok, true);

      const result = await execution;
      assert.equal(result.text, "The approved file was written.");
      assert.equal(
        fs.readFileSync(path.join(root, "approved.txt"), "utf8"),
        "approved write\n"
      );
      const writeRecord = session.getRecords().find(
        (record) => record.name === "write_text_file"
      );
      assert.equal(writeRecord.status, "completed");
      assert.equal(writeRecord.input.expectedSha256, "");
      assert.equal(approvalController.approvalSnapshot(), null);
    } finally {
      approvalController.close();
      await session.closePersistence();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

});
