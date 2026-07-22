import { it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  readAgentRuntimeSource
} from "../helpers/agentRuntimeSource.js";

function source(path) {
  return fs.readFileSync(path, "utf8");
}

it("95 embeds local diffs and command output in the tool timeline, then shows one final diff", () => {
  const messageList = source("src/Conversation/components/MessageList.jsx");
  const taskPanel = source("src/Conversation/components/TaskPanel.jsx");
  assert.match(messageList, /ToolCommandPreview/u);
  assert.match(messageList, /FileDiffPreview/u);
  assert.match(messageList, /FinalDiffSummary/u);
  assert.doesNotMatch(messageList, /FileChangesSummary/u);
  assert.match(messageList, /message\.diffSummary/u);
  assert.match(taskPanel, /ToolCommandPreview/u);
});

it("95 registers a controlled package-script process tool in the Coding capability surface", () => {
  const processTools = source("electron/tools/workspace/workspaceProcessTools.js");
  const presentation = source("electron/tools/manifest/builtinToolPresentation.js");
  const mapping = source("electron/tools/capabilities/CapabilityMapping.js");
  const catalog = source("electron/tools/toolCatalog.js");
  assert.match(processTools, /name:\s*"run_project_script"/u);
  assert.match(processTools, /shell:\s*false/u);
  assert.match(processTools, /PACKAGE_SCRIPT_NOT_FOUND/u);
  assert.match(presentation, /run_project_script/u);
  assert.match(mapping, /run_project_script:\s*\["process\.execute"\]/u);
  assert.match(catalog, /toolset === "workspace\.exec"/u);
  assert.match(catalog, /mode === "coding"/u);
});

it("95 computes final diffs from the first baseline instead of concatenating write previews", () => {
  const tracker = source("electron/agent/RunDiffTracker.js");
  const runtime = readAgentRuntimeSource();
  const writeTools = source("electron/tools/workspace/workspaceWriteTools.js");
  assert.match(tracker, /class RunDiffTracker/u);
  assert.match(tracker, /previous\?\.before/u);
  assert.match(runtime, /diffTracker\?\.snapshot/u);
  assert.match(writeTools, /onFileMutation/u);
});
