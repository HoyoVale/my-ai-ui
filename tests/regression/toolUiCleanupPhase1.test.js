import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { sanitizeActivity } from "../../electron/conversation/activitySchema.js";
import { isActivityEventVisible } from "../../src/Conversation/utils/taskActivity.js";

function read(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("Tool UI cleanup phase 1", () => {
  it("hides runtime lifecycle events in normal mode and exposes them in developer mode", () => {
    const lifecycle = {
      id: "progress:run:1",
      type: "status",
      status: "completed",
      category: "runtime",
      activityVisibility: "developer",
      title: "当前阶段已完成"
    };

    assert.equal(isActivityEventVisible(lifecycle), false);
    assert.equal(isActivityEventVisible(lifecycle, { developerMode: true }), true);
  });

  it("never hides real user-facing failure states", () => {
    const failed = {
      id: "run:failed",
      type: "status",
      status: "failed",
      category: "runtime",
      activityVisibility: "developer",
      title: "执行失败"
    };

    assert.equal(isActivityEventVisible(failed), true);
  });

  it("persists lifecycle visibility metadata", () => {
    const activity = sanitizeActivity({
      taskId: "task",
      runId: "run",
      status: "completed",
      events: [{
        id: "progress:run:1",
        type: "status",
        status: "completed",
        category: "runtime",
        activityVisibility: "developer",
        title: "继续执行任务"
      }]
    });

    assert.equal(activity.events[0].category, "runtime");
    assert.equal(activity.events[0].activityVisibility, "developer");
  });

  it("migrates old progress events to developer-only lifecycle events", () => {
    const activity = sanitizeActivity({
      taskId: "legacy-task",
      runId: "legacy-run",
      status: "completed",
      events: [{
        id: "progress:legacy-run:1",
        type: "status",
        status: "completed",
        title: "当前阶段已完成"
      }]
    });

    assert.equal(activity.events[0].category, "runtime");
    assert.equal(activity.events[0].activityVisibility, "developer");
  });

  it("removes the obsolete activity level and diagnostic cards from Tool settings", () => {
    const panel = read("../../src/Setting/panels/ToolPanel.jsx");
    const defaults = read("../../src/shared/defaultSettings.js");
    const conversation = read("../../src/Conversation/Conversation.jsx");

    assert.doesNotMatch(panel, /活动显示|展示层级|当前模型|固定安全边界/u);
    assert.doesNotMatch(defaults, /detailLevel/u);
    assert.doesNotMatch(conversation, /toolDetailLevel|detailLevel/u);
    assert.match(panel, /developerMode &&/u);
  });
});
