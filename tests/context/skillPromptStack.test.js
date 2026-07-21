import assert from "node:assert/strict";
import test from "node:test";

import { assembleAgentContext } from "../../electron/context/ContextAssembler.js";
import { DEFAULT_SETTINGS } from "../../electron/settings/defaultSettings.js";

test("Skill Prompt Stack sits below developer instructions and above preferences", () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.prompts.developerInstructions = "Developer instruction.";
  const context = assembleAgentContext({
    settings,
    conversation: {
      id: "conversation",
      mode: "chat",
      messages: []
    },
    memories: [],
    skillRuntime: {
      active: true,
      skill: {
        id: "review",
        name: "Review",
        version: "1.0.0",
        requiredCapabilities: ["runtime.info"],
        optionalCapabilities: []
      },
      promptSection: "Active Skill: Review\nInspect the answer."
    }
  });

  const authorities = context.promptSections
    .filter((section) => section.content)
    .map((section) => section.authority);
  assert.ok(authorities.indexOf("developer") < authorities.indexOf("skill"));
  assert.ok(authorities.indexOf("skill") < authorities.indexOf("preference"));
  assert.match(context.system, /Active Skill workflow: Review/u);
  assert.equal(context.metadata.prompt.skillEnabled, true);
  assert.equal(context.metadata.skill.id, "review");
});
