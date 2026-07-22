import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const lines = (source) => source.split(/\r?\n/u).length;

describe("Core Runtime phase 3 architecture", () => {
  it("keeps PlatformKernel as a compact public facade", () => {
    const facade = read("electron/platform/PlatformKernel.js");
    assert.ok(lines(facade) < 400, `PlatformKernel facade is still ${lines(facade)} lines`);
    for (const service of [
      "PlatformStateProjector",
      "PlatformRunService",
      "PlatformTaskService",
      "PlatformLeaseService",
      "PlatformLongRunningService",
      "PlatformCompletionService"
    ]) {
      assert.match(facade, new RegExp(`${service}\\.`, "u"));
    }
    assert.doesNotMatch(facade, /case "RUN_CREATED"/u);
    assert.doesNotMatch(facade, /JOB_TRANSITIONS/u);
    assert.doesNotMatch(facade, /completionAuthority\.issue/u);
  });

  it("owns each Platform lifecycle in one service", () => {
    const state = read("electron/platform/state/PlatformStateProjector.js");
    const runs = read("electron/platform/runs/PlatformRunService.js");
    const tasks = read("electron/platform/tasks/PlatformTaskService.js");
    const leases = read("electron/platform/leases/PlatformLeaseService.js");
    const jobs = read("electron/platform/jobs/PlatformLongRunningService.js");
    const completion = read("electron/platform/completion/PlatformCompletionService.js");
    assert.match(state, /applyEvent\(/u);
    assert.match(runs, /prepareExecution\(/u);
    assert.match(tasks, /addTaskGraph\(/u);
    assert.match(leases, /acquireLease\(/u);
    assert.match(jobs, /enqueueJob\(/u);
    assert.match(completion, /authorizeCompletion\(/u);
  });

  it("keeps ConversationManager as a compact public facade", () => {
    const facade = read("electron/conversation/ConversationManager.js");
    assert.ok(lines(facade) < 380, `ConversationManager facade is still ${lines(facade)} lines`);
    for (const service of [
      "ConversationStateService",
      "ConversationExecutionService",
      "ConversationMessageService",
      "ConversationToolRecoveryService"
    ]) {
      assert.match(facade, new RegExp(`${service}\\.`, "u"));
    }
    assert.doesNotMatch(facade, /recoverInterruptedGoal\(/u);
    assert.doesNotMatch(facade, /buildShortTermContext\(/u);
    assert.doesNotMatch(facade, /conversation\.messages\.push/u);
  });

  it("owns Conversation state, execution, messages and recovery separately", () => {
    const state = read("electron/conversation/services/ConversationStateService.js");
    const execution = read("electron/conversation/services/ConversationExecutionService.js");
    const messages = read("electron/conversation/services/ConversationMessageService.js");
    const recovery = read("electron/conversation/services/ConversationToolRecoveryService.js");
    assert.match(state, /create\(/u);
    assert.match(state, /navigateContext\(/u);
    assert.match(execution, /beginExecutionThread\(/u);
    assert.match(execution, /beginGoalRun\(/u);
    assert.match(messages, /appendMessage\(/u);
    assert.match(messages, /prepareRegeneration\(/u);
    assert.match(recovery, /updateToolRuntimeRecovery\(/u);
  });

  it("does not create circular imports back into the facades", () => {
    const serviceFiles = [
      "electron/platform/state/PlatformStateProjector.js",
      "electron/platform/runs/PlatformRunService.js",
      "electron/platform/tasks/PlatformTaskService.js",
      "electron/platform/leases/PlatformLeaseService.js",
      "electron/platform/jobs/PlatformLongRunningService.js",
      "electron/platform/completion/PlatformCompletionService.js",
      "electron/conversation/services/ConversationStateService.js",
      "electron/conversation/services/ConversationExecutionService.js",
      "electron/conversation/services/ConversationMessageService.js",
      "electron/conversation/services/ConversationToolRecoveryService.js"
    ];
    for (const file of serviceFiles) {
      const source = read(file);
      assert.doesNotMatch(source, /from "\.\.\/PlatformKernel\.js"/u, file);
      assert.doesNotMatch(source, /from "\.\.\/ConversationManager\.js"/u, file);
    }
  });
});
