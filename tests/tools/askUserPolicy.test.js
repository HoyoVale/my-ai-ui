import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  RunPlanStore
} from "../../electron/tools/agent/agentTools.js";

import {
  createDecisionKey
} from "../../electron/tools/agent/askUserPolicy.js";

import {
  RunActivityStore
} from "../../electron/agent/RunActivityStore.js";

describe("ask_user decision policy", () => {
  it("blocks the same decision after the user already answered it", () => {
    const answered = {
      question: "Choose a folder",
      options: [
        {
          id: "src",
          label: "src"
        },
        {
          id: "tests",
          label: "tests"
        }
      ]
    };
    const store = new RunPlanStore(
      [],
      {
        answeredQuestions: [
          {
            ...answered,
            decisionKey:
              createDecisionKey(answered)
          }
        ]
      }
    );

    const result = store.canAskUser(
      answered
    );

    assert.equal(result.ok, false);
    assert.equal(
      result.code,
      "ASK_USER_ALREADY_ANSWERED"
    );
  });

  it("requires progress before another question can be asked after resume", () => {
    const store = new RunPlanStore(
      [],
      {
        answeredQuestions: [
          {
            decisionId: "first",
            question: "First choice"
          }
        ]
      }
    );

    const blocked = store.canAskUser({
      decisionId: "second",
      question: "Second choice"
    });

    assert.equal(blocked.ok, false);
    assert.equal(
      blocked.code,
      "ASK_USER_MUST_ADVANCE"
    );

    store.noteToolExecution(
      "calculator"
    );

    assert.equal(
      store.canAskUser({
        decisionId: "second",
        question: "Second choice"
      }).ok,
      true
    );
  });

  it("enforces a per-task question budget", () => {
    const store = new RunPlanStore(
      [],
      {
        initialQuestionCount: 3,
        maxQuestions: 3
      }
    );

    const result = store.canAskUser({
      decisionId: "fourth",
      question: "Another question"
    });

    assert.equal(result.ok, false);
    assert.equal(
      result.code,
      "ASK_USER_LIMIT"
    );
  });

  it("keeps separate question events instead of overwriting the previous checkpoint", () => {
    const activity = new RunActivityStore({
      taskId: "task",
      runId: "run",
      startedAt: 1
    });

    activity.recordQuestion({
      question: "First"
    }, 2);
    activity.markQuestionAnswered({
      answer: "A"
    }, 3);
    activity.recordQuestion({
      question: "Second"
    }, 4);

    const questions =
      activity.snapshot().events
        .filter(
          (event) =>
            event.type === "question"
        );

    assert.equal(questions.length, 2);
    assert.equal(
      questions[0].status,
      "answered"
    );
    assert.equal(
      questions[1].status,
      "waiting_for_user"
    );
  });
});
