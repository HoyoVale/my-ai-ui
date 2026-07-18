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
          /窗口排版/u
        );
        assert.match(
          source,
          /WINDOW_OPTIONS/u
        );
        assert.match(
          source,
          /appearance-typography-window/u
        );
      }
    );
  }
);


describe(
  "official SDK model interface",
  () => {
    it(
      "installs first-party provider SDKs and the native Ollama provider",
      () => {
        const packageSource = read(
          "../../package.json"
        );

        for (const dependency of [
          "@ai-sdk/openai",
          "@ai-sdk/anthropic",
          "@ai-sdk/openai-compatible",
          "ollama-ai-provider-v2"
        ]) {
          assert.match(
            packageSource,
            new RegExp(dependency.replace("/", "\\/"), "u")
          );
        }
      }
    );

    it(
      "keeps provider selection, model navigation and advanced generation settings separated",
      () => {
        const source = read(
          "../../src/Setting/panels/ModelPanel.jsx"
        );

        assert.match(source, /model-provider-header/u);
        assert.match(source, /model-list-card/u);
        assert.match(source, /model-config-card/u);
        assert.match(source, /API 模式/u);
        assert.match(source, /推理模式/u);
        assert.match(source, /失败重试/u);
      }
    );

    it(
      "routes providers through the SDK registry instead of handwritten protocol adapters",
      () => {
        const source = read(
          "../../electron/agent/providers/sdkProviderRegistry.js"
        );

        assert.match(source, /createOpenAI/u);
        assert.match(source, /createAnthropic/u);
        assert.match(source, /createOpenAICompatible/u);
        assert.match(source, /createOllama/u);
        assert.match(source, /createDeepSeek/u);
      }
    );
  }
);
