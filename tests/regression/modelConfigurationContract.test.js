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


describe(
  "expanded provider and typography UI contract",
  () => {
    it(
      "exposes OpenAI, Anthropic, Ollama and compatible provider presets",
      () => {
        const source =
          read(
            "../../electron/settings/providerDefaults.js"
          );

        for (const providerId of [
          "openai",
          "anthropic",
          "ollama",
          "compatible"
        ]) {
          assert.match(
            source,
            new RegExp(`${providerId}:`, "u")
          );
        }
      }
    );

    it(
      "uses current input as the primary Context metric",
      () => {
        const source =
          read(
            "../../src/Conversation/components/ContextInspector.jsx"
          );

        assert.match(
          source,
          /当前输入占用（估算）/u
        );
        assert.match(
          source,
          /currentInputRatio/u
        );
        assert.match(
          source,
          /最坏情况请求预算/u
        );
      }
    );

    it(
      "keeps a global font family and per-window typography controls",
      () => {
        const source =
          read(
            "../../src/Setting/panels/AppearancePanel.jsx"
          );

        assert.match(
          source,
          /全局字体/u
        );
        assert.match(
          source,
          /appearance-font-family/u
        );
        assert.match(
          source,
          /窗口文字与密度/u
        );
        assert.match(
          source,
          /WINDOW_OPTIONS/u
        );
      }
    );
  }
);
