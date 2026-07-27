import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Core Lite removes the standalone Plan dock and its dead stylesheet", () => {
  assert.equal(fs.existsSync(path.join(root, "src/Conversation/components/PlanDock.jsx")), false);
  assert.equal(fs.existsSync(path.join(root, "src/Conversation/styles/plan-goal.css")), false);
  assert.doesNotMatch(read("src/Conversation/Conversation.jsx"), /ConversationPlanDock|conversation-plan-dock/u);
});

test("historical Plan snapshots remain read-only activity data", () => {
  const activity = read("src/Conversation/utils/taskActivity.js");
  const taskPanel = read("src/Conversation/components/TaskPanel.jsx");
  const messageList = read("src/Conversation/components/MessageList.jsx");

  assert.match(activity, /normalizePlanStateForView/u);
  assert.match(activity, /planState\.rootItems/u);
  assert.match(activity, /activeSubplan/u);
  assert.match(taskPanel, /panelTimelineEvents/u);
  assert.match(messageList, /ActivityTimeline/u);
  assert.match(read("src/Conversation/components/taskPanelModel.js"), /isActivityEventVisible/u);
  assert.doesNotMatch(taskPanel, /DeveloperPlanInspector|conversation-developer-subplans/u);
  assert.doesNotMatch(taskPanel, /"update_plan"/u);
  assert.doesNotMatch(messageList, /"update_plan"/u);
});
