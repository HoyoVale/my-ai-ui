import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function read(relativePath) {
  return fs.readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

function lineCount(source) {
  return source.split(/\r?\n/u).length;
}

test("Phase 4 keeps the Conversation shell and primary panels compact", () => {
  assert.ok(lineCount(read("src/Conversation/Conversation.jsx")) <= 220);
  assert.ok(lineCount(read("src/Conversation/components/MessageList.jsx")) <= 550);
  assert.ok(lineCount(read("src/Conversation/components/TaskPanel.jsx")) <= 280);
  assert.ok(lineCount(read("src/Conversation/Conversation.css")) <= 24);
});

test("Phase 4 assigns panel behavior to one focused module", () => {
  const shell = read("src/Conversation/Conversation.jsx");
  const controller = read("src/Conversation/hooks/useConversationViewController.js");
  const messages = read("src/Conversation/components/MessageList.jsx");
  const activity = read("src/Conversation/components/ActivityTimeline.jsx");
  const taskPanel = read("src/Conversation/components/TaskPanel.jsx");
  const taskTimeline = read("src/Conversation/components/TaskActivityTimeline.jsx");
  const developer = read("src/Conversation/components/DeveloperActivityPanel.jsx");

  assert.match(shell, /useConversationViewController/u);
  assert.doesNotMatch(shell, /useState|useEffect|ACTIVE_AGENT_STATES/u);
  assert.match(controller, /toggleContext/u);
  assert.match(controller, /openTaskPanel/u);

  assert.match(messages, /AssistantActivity/u);
  assert.doesNotMatch(messages, /function ThinkingTimeline|function TimelineEvent/u);
  assert.match(activity, /function ThinkingTimeline/u);
  assert.match(activity, /export function LiveAgentActivity/u);

  assert.match(taskPanel, /ActivityTimelineEvent/u);
  assert.match(taskPanel, /DeveloperActivity/u);
  assert.doesNotMatch(taskPanel, /function ToolDetails|function RawDetail/u);
  assert.match(taskTimeline, /export function ActivityTimelineEvent/u);
  assert.match(developer, /function ToolDetails/u);
});

test("Phase 4 keeps Conversation CSS in an ordered responsibility manifest", () => {
  const manifest = read("src/Conversation/Conversation.css");
  const expected = [
    "shell.css",
    "messages.css",
    "task-panel.css",
    "activity.css",
    "navigation.css",
    "plan-goal.css",
    "platform.css",
    "approval.css",
    "responsive.css",
    "diff-command.css"
  ];

  let cursor = -1;
  for (const file of expected) {
    const next = manifest.indexOf(file);
    assert.ok(next > cursor, `${file} should keep its cascade position`);
    cursor = next;
    assert.ok(fs.existsSync(new URL(`../../src/Conversation/styles/${file}`, import.meta.url)));
  }

  assert.doesNotMatch(manifest, /\.conversation-[\w-]+\s*\{/u);
});

test("Phase 4 child modules never import their facade", () => {
  for (const file of [
    "src/Conversation/hooks/useConversationViewController.js",
    "src/Conversation/components/ActivityTimeline.jsx",
    "src/Conversation/components/MessagePrimitives.jsx",
    "src/Conversation/components/TaskActivityTimeline.jsx",
    "src/Conversation/components/DeveloperActivityPanel.jsx",
    "src/Conversation/components/taskPanelModel.js"
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:Conversation|MessageList|TaskPanel)\.jsx["']/u);
  }
});
