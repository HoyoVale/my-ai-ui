import { it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

it("routes every public Run ending through the terminal presentation resolver", () => {
  const finalization = read("../../electron/agent/finalization/AgentRunFinalization.js");
  const execution = read("../../electron/agent/execution/AgentRunExecution.js");
  const persistence = read("../../electron/agent/persistence/AgentRunPersistence.js");
  const conversation = read("../../electron/conversation/services/ConversationMessageService.js");
  const view = read("../../src/Conversation/components/userTaskViewModel.js");

  assert.match(finalization, /resolveRunTerminalPresentation\(/u);
  assert.match(finalization, /composeTerminalResponse\(/u);
  assert.match(finalization, /runTerminal:\s*terminal/u);
  assert.doesNotMatch(execution, /const errorText = `⚠/u);
  assert.match(execution, /providerClassification/u);
  assert.match(persistence, /runTerminal/u);
  assert.match(conversation, /metadata\.run[\s\S]*terminal/u);
  assert.match(view, /snapshot\?\.terminal/u);
});
