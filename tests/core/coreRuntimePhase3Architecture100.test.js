import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const lines = (source) => source.split(/\r?\n/u).length;

describe("Core Runtime phase 3 architecture", () => {
  it("physically removes the retired Platform runtime", () => {
    assert.equal(fs.existsSync(path.join(root, "electron/platform")), false);
    assert.equal(fs.existsSync(path.join(root, "tests/platform")), false);
  });

  it("keeps ConversationManager as a compact public facade", () => {
    const facade = read("electron/conversation/ConversationManager.js");
    assert.ok(lines(facade) < 380, `ConversationManager facade is still ${lines(facade)} lines`);
    for (const service of [
      "ConversationStateService",
      "ConversationMessageService",
      "ConversationToolRecoveryService"
    ]) {
      assert.match(facade, new RegExp(`${service}\\.`, "u"));
    }
    assert.doesNotMatch(facade, /recoverInterruptedGoal\(/u);
    assert.doesNotMatch(facade, /buildShortTermContext\(/u);
    assert.doesNotMatch(facade, /conversation\.messages\.push/u);
  });

  it("owns Conversation state, messages and Tool recovery separately", () => {
    const state = read("electron/conversation/services/ConversationStateService.js");
    const messages = read("electron/conversation/services/ConversationMessageService.js");
    const recovery = read("electron/conversation/services/ConversationToolRecoveryService.js");
    assert.match(state, /create\(/u);
    assert.match(state, /navigateContext\(/u);
    assert.match(messages, /appendMessage\(/u);
    assert.match(messages, /prepareRegeneration\(/u);
    assert.match(recovery, /updateToolRuntimeRecovery\(/u);
    assert.equal(
      fs.existsSync(path.join(root, "electron/conversation/services/ConversationExecutionService.js")),
      false
    );
  });

  it("does not create circular imports back into the Conversation facade", () => {
    for (const file of [
      "electron/conversation/services/ConversationStateService.js",
      "electron/conversation/services/ConversationMessageService.js",
      "electron/conversation/services/ConversationToolRecoveryService.js"
    ]) {
      assert.doesNotMatch(read(file), /from "\.\.\/ConversationManager\.js"/u, file);
    }
  });
});
