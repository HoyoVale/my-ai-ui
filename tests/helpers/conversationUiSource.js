import fs from "node:fs";

function read(relativePath) {
  return fs.readFileSync(
    new URL(`../../src/Conversation/${relativePath}`, import.meta.url),
    "utf8"
  );
}

function join(paths) {
  return paths.map((path) => read(path)).join("\n");
}

export function readConversationShellSource() {
  return join([
    "Conversation.jsx",
    "hooks/useConversationViewController.js"
  ]);
}

export function readConversationMessageSource() {
  return join([
    "components/MessageList.jsx",
    "components/ActivityTimeline.jsx",
    "components/MessagePrimitives.jsx"
  ]);
}

export function readConversationTaskPanelSource() {
  return join([
    "components/TaskPanel.jsx",
    "components/TaskActivityTimeline.jsx",
    "components/DeveloperActivityPanel.jsx",
    "components/taskPanelModel.js"
  ]);
}

export function readConversationStyles() {
  return join([
    "Conversation.css",
    "styles/shell.css",
    "styles/messages.css",
    "styles/task-panel.css",
    "styles/activity.css",
    "styles/navigation.css",
    "styles/plan-goal.css",
    "styles/platform.css",
    "styles/approval.css",
    "styles/responsive.css",
    "styles/diff-command.css"
  ]);
}
