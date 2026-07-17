import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import fs from "node:fs";

function read(relativePath) {
  return fs.readFileSync(
    new URL(
      relativePath,
      import.meta.url
    ),
    "utf8"
  );
}

describe(
  "multi-model provider configuration",
  () => {
    it(
      "keeps context limits on model entries and selects an active model",
      () => {
        const source =
          read(
            "../../src/Setting/panels/ModelPanel.jsx"
          );

        assert.match(
          source,
          /provider\.models/u
        );
        assert.match(
          source,
          /activeModelId/u
        );
        assert.match(
          source,
          /model-context-limit/u
        );
        assert.match(
          source,
          /添加模型/u
        );
      }
    );

    it(
      "removes the context token control from the Context panel",
      () => {
        const source =
          read(
            "../../src/Setting/panels/ConversationPanel.jsx"
          );

        assert.doesNotMatch(
          source,
          /contextTokenBudget/u
        );
        assert.doesNotMatch(
          source,
          /上下文 Token 上限/u
        );
      }
    );
  }
);
