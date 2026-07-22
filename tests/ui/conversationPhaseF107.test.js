import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  createToolActivityView
} from "../../src/Conversation/components/toolActivityModel.js";

import {
  createUserTaskViewModel
} from "../../src/Conversation/components/userTaskViewModel.js";

function read(relativePath) {
  return fs.readFileSync(
    new URL(`../../${relativePath}`, import.meta.url),
    "utf8"
  );
}

test("Phase F projects command, diff and generic tool replies for ordinary users", () => {
  const command = createToolActivityView({
    id: "tool-command",
    name: "run_project_script",
    title: "Run tests",
    status: "completed",
    durationMs: 1500,
    result: {
      summary: "全部测试通过",
      commandPreview: {
        displayCommand: "npm test",
        exitCode: 0,
        stdout: "12 passed"
      }
    }
  });

  assert.equal(command.kind, "command");
  assert.equal(command.title, "已运行命令");
  assert.equal(command.summary, "全部测试通过");
  assert.equal(command.failed, false);

  const diff = createToolActivityView({
    id: "tool-diff",
    name: "write_file",
    status: "completed",
    result: {
      summary: "更新了两个文件",
      changePreview: {
        paths: ["src/a.js", "src/b.js"],
        diff: "--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1 @@\n-old\n+new"
      }
    }
  });

  assert.equal(diff.kind, "diff");
  assert.equal(diff.title, "已修改文件");
  assert.deepEqual(diff.change.paths, ["src/a.js", "src/b.js"]);

  const generic = createToolActivityView({
    id: "tool-read",
    name: "read_file",
    title: "读取文件",
    status: "failed",
    input: { path: "src/missing.js" },
    result: {
      error: { message: "文件不存在" }
    }
  });

  assert.equal(generic.kind, "tool");
  assert.equal(generic.summary, "文件不存在");
  assert.equal(generic.failed, true);
});

test("Phase F maps complex runtime states into a small user task vocabulary", () => {
  const working = createUserTaskViewModel({
    running: true,
    events: [{
      type: "tool",
      status: "running",
      tool: {
        status: "running",
        result: {
          commandPreview: {
            displayCommand: "npm run test",
            exitCode: null
          }
        }
      }
    }]
  }, { live: true });

  assert.equal(working.state, "working");
  assert.equal(working.label, "正在处理");
  assert.match(working.detail, /npm run test/u);

  const interrupted = createUserTaskViewModel({
    interrupted: true,
    stopReason: "interrupted",
    events: []
  });

  assert.equal(interrupted.state, "continuable");
  assert.equal(interrupted.canContinue, true);
  assert.equal(interrupted.label, "任务已中断");
});

test("Phase F uses one shared public tool card in the thread and task panel", () => {
  const messageActivity = read("src/Conversation/components/ActivityTimeline.jsx");
  const taskActivity = read("src/Conversation/components/TaskActivityTimeline.jsx");
  const card = read("src/Conversation/components/ToolActivityCard.jsx");
  const command = read("src/Conversation/components/CommandOutput.jsx");
  const diff = read("src/Conversation/components/FileDiff.jsx");

  assert.match(messageActivity, /ToolActivityCard/u);
  assert.match(taskActivity, /ToolActivityCard/u);
  assert.match(card, /ToolCommandPreview/u);
  assert.match(card, /FileDiffPreview/u);
  assert.match(card, /conversation-tool-card/u);
  assert.match(command, /conversation-tool-reply/u);
  assert.match(command, /showMetadata/u);
  assert.match(diff, /<details[\s\S]*conversation-final-diff/u);
});

test("Phase F keeps raw tool internals developer-only", () => {
  const publicCard = read("src/Conversation/components/ToolActivityCard.jsx");
  const publicTimeline = read("src/Conversation/components/ActivityTimeline.jsx");
  const developer = read("src/Conversation/components/DeveloperActivityPanel.jsx");

  assert.doesNotMatch(publicCard, /Runtime contract|Model output|Tool Receipt/u);
  assert.doesNotMatch(publicTimeline, /Thread ID|Run ID|Routing Decision|Provider Continuation/u);
  assert.match(developer, /Runtime contract/u);
  assert.match(developer, /Model output/u);
  assert.match(developer, /showMetadata/u);
});

test("Phase F removes thinking-language from the ordinary progress surface", () => {
  const activity = read("src/Conversation/components/ActivityTimeline.jsx");
  const model = read("src/Conversation/components/userTaskViewModel.js");
  const panel = read("src/Conversation/components/TaskPanel.jsx");

  assert.match(model, /正在处理/u);
  assert.match(panel, />进度</u);
  assert.doesNotMatch(activity, /思考中|思考过程|思考了/u);
  assert.doesNotMatch(panel, /思考中|思考过程|思考了/u);
});

test("Phase F loads the dedicated Codex-style tool card stylesheet last", () => {
  const manifest = read("src/Conversation/Conversation.css");
  const styles = read("src/Conversation/styles/tool-cards.css");

  assert.ok(manifest.indexOf("tool-cards.css") > manifest.indexOf("diff-command.css"));
  assert.match(styles, /conversation-command-output__terminal/u);
  assert.match(styles, /conversation-file-diff__summary-copy/u);
  assert.match(styles, /conversation-task-state-mark/u);
});
