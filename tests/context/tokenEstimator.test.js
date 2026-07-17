import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import {
  buildTokenBudget,
  estimateMessageTokens,
  estimateTextTokens
} from "../../electron/context/tokenEstimator.js";

describe(
  "token estimator",
  () => {
    it(
      "estimates mixed Chinese and English text",
      () => {
        assert.equal(
          estimateTextTokens("中文ab"),
          2
        );

        assert.equal(
          estimateMessageTokens([
            {
              content: "hello"
            }
          ]) > 4,
          true
        );
      }
    );

    it(
      "builds total and per-section budget",
      () => {
        const budget =
          buildTokenBudget({
            contextTokenBudget: 1024,
            outputReserve: 20,
            sections: [
              {
                id: "a",
                label: "A",
                tokens: 30
              },
              {
                id: "b",
                label: "B",
                tokens: 10
              }
            ]
          });

        assert.equal(
          budget.inputTokens,
          40
        );
        assert.equal(
          budget.totalTokens,
          60
        );
        assert.equal(
          budget.remaining,
          964
        );
        assert.equal(
          budget.sections[0]
            .inputShareRatio,
          0.75
        );
        assert.equal(
          budget.sections[1]
            .inputShareRatio,
          0.25
        );
        assert.equal(
          budget.usageRatio,
          60 / 1024
        );
      }
    );
  }
);
