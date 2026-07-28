import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createUserTaskViewModel
} from "../../src/Conversation/components/userTaskViewModel.js";

describe("Run terminal user view", () => {
  it("uses the stable terminal title and message for a Provider failure", () => {
    const view = createUserTaskViewModel({
      failed: true,
      terminal: {
        kind: "failure",
        title: "无法连接模型服务",
        message: "请检查网络后重试。",
        resumable: false
      }
    });

    assert.deepEqual(view, {
      state: "failed",
      label: "无法连接模型服务",
      detail: "请检查网络后重试。",
      canContinue: false
    });
  });

  it("separates attention states from completed tasks", () => {
    const view = createUserTaskViewModel({
      terminal: {
        kind: "attention",
        title: "需要确认工具操作",
        message: "完成确认后可以继续任务。",
        resumable: false
      }
    });

    assert.equal(view.state, "attention");
    assert.equal(view.label, "需要确认工具操作");
    assert.equal(view.canContinue, false);
  });

  it("uses one continuable state for saved checkpoints", () => {
    const view = createUserTaskViewModel({
      interrupted: true,
      terminal: {
        kind: "continuable",
        title: "当前进度已保存",
        message: "可以从当前检查点继续任务。",
        resumable: true
      }
    });

    assert.equal(view.state, "continuable");
    assert.equal(view.canContinue, true);
    assert.equal(view.label, "当前进度已保存");
  });
});
