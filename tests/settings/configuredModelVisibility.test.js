import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import {
  sanitizeSettings
} from "../../electron/settings/validateSettings.js";

import {
  flattenModels
} from "../../src/Input/hooks/useInputContext.js";

describe(
  "configured model visibility",
  () => {
    it(
      "removes inactive historical template providers from persisted settings",
      () => {
        const settings = sanitizeSettings({
          model: {
            activeProvider: "ollama",
            providers: {
              openai: {
                id: "openai",
                type: "openai",
                name: "OpenAI",
                baseURL: "https://api.openai.com/v1",
                activeModelId: "gpt-4.1-mini",
                models: [
                  {
                    id: "gpt-4.1-mini",
                    name: "GPT-4.1 mini",
                    modelId: "gpt-4.1-mini"
                  }
                ]
              },
              anthropic: {
                id: "anthropic",
                type: "anthropic",
                name: "Anthropic",
                baseURL: "https://api.anthropic.com/v1",
                activeModelId: "claude-sonnet-4",
                models: [
                  {
                    id: "claude-sonnet-4",
                    name: "Claude Sonnet 4",
                    modelId: "claude-sonnet-4"
                  }
                ]
              },
              compatible: {
                id: "compatible",
                type: "openai-compatible",
                name: "OpenAI-compatible",
                baseURL: "http://localhost:1234/v1",
                activeModelId: "compatible-model",
                models: [
                  {
                    id: "compatible-model",
                    name: "Compatible model",
                    modelId: "model-id"
                  }
                ]
              },
              ollama: {
                id: "ollama",
                type: "ollama",
                name: "Ollama",
                baseURL: "http://127.0.0.1:11434/api",
                activeModelId: "gemma4:e4b",
                models: [
                  {
                    id: "qwen2.5:7b",
                    name: "qwen2.5:7b",
                    modelId: "qwen2.5:7b"
                  },
                  {
                    id: "gemma4:e4b",
                    name: "gemma4:e4b",
                    modelId: "gemma4:e4b"
                  }
                ]
              }
            }
          }
        });

        assert.deepEqual(
          Object.keys(settings.model.providers),
          ["ollama"]
        );

        assert.deepEqual(
          flattenModels(settings).map((model) => model.label),
          ["gemma4:e4b", "qwen2.5:7b"]
        );
      }
    );

    it(
      "keeps an explicitly configured provider even when it uses a template model id",
      () => {
        const settings = sanitizeSettings({
          model: {
            activeProvider: "openai",
            providers: {
              openai: {
                id: "openai",
                configured: true,
                type: "openai",
                name: "OpenAI",
                baseURL: "https://api.openai.com/v1",
                activeModelId: "gpt-4.1-mini",
                models: [
                  {
                    id: "gpt-4.1-mini",
                    name: "GPT-4.1 mini",
                    modelId: "gpt-4.1-mini"
                  }
                ]
              }
            }
          }
        });

        assert.equal(
          settings.model.providers.openai.configured,
          true
        );
        assert.deepEqual(
          flattenModels(settings).map((model) => model.label),
          ["GPT-4.1 mini"]
        );
      }
    );

    it(
      "returns no Input models before a provider is explicitly configured",
      () => {
        const settings = sanitizeSettings({});

        assert.deepEqual(
          settings.model.providers,
          {}
        );
        assert.deepEqual(
          flattenModels(settings),
          []
        );
      }
    );
  }
);
