import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import {
  resolveActiveModelSettings,
  resolveWorkerModelSettings
} from "../../electron/settings/modelSettings.js";

describe(
  "active model resolution",
  () => {
    it(
      "resolves the selected model inside one provider",
      () => {
        const resolved =
          resolveActiveModelSettings({
            activeProvider: "deepseek",
            providers: {
              deepseek: {
                id: "deepseek",
                type: "deepseek",
                name: "DeepSeek",
                baseURL: "https://api.deepseek.com",
                activeModelId: "pro",
                models: [
                  {
                    id: "flash",
                    name: "Flash",
                    modelId: "deepseek-v4-flash",
                    contextTokenBudget: 64000,
                    temperature: 0.4,
                    maxOutputTokens: 4096,
                    timeoutMs: 60000
                  },
                  {
                    id: "pro",
                    name: "Pro",
                    modelId: "deepseek-v4-pro",
                    contextTokenBudget: 1000000,
                    temperature: 0.8,
                    maxOutputTokens: 32768,
                    timeoutMs: 120000
                  }
                ]
              }
            }
          });

        assert.equal(
          resolved.modelConfigId,
          "pro"
        );
        assert.equal(
          resolved.model,
          "deepseek-v4-pro"
        );
        assert.equal(
          resolved.contextTokenBudget,
          1000000
        );
      }
    );
  }
);

describe("independent runtime model assignments", () => {
  it("resolves the Worker without changing the active main model", () => {
    const settings = {
      activeProvider: "main-provider",
      runtimeAssignments: {
        worker: {
          providerId: "worker-provider",
          modelConfigId: "worker"
        }
      },
      providers: {
        "main-provider": {
          id: "main-provider",
          type: "openai-compatible",
          name: "Main",
          baseURL: "https://main.invalid/v1",
          activeModelId: "main",
          models: [{
            id: "main",
            name: "Main model",
            modelId: "main-model",
            contextTokenBudget: 64000,
            maxOutputTokens: 4096,
            timeoutMs: 60000
          }]
        },
        "worker-provider": {
          id: "worker-provider",
          type: "openai-compatible",
          name: "Worker",
          baseURL: "https://worker.invalid/v1",
          activeModelId: "worker",
          models: [{
            id: "worker",
            name: "Worker model",
            modelId: "worker-model",
            contextTokenBudget: 32000,
            maxOutputTokens: 2048,
            timeoutMs: 60000
          }]
        }
      }
    };
    assert.equal(resolveActiveModelSettings(settings).model, "main-model");
    assert.equal(resolveWorkerModelSettings(settings).model, "worker-model");
    assert.equal(resolveWorkerModelSettings(settings).providerId, "worker-provider");
  });
});


describe(
  "expanded provider resolution",
  () => {
    it(
      "resolves an OpenAI-compatible provider with its credential policy",
      () => {
        const resolved =
          resolveActiveModelSettings({
            activeProvider: "ollama",
            providers: {
              ollama: {
                id: "ollama",
                type: "ollama",
                name: "Ollama",
                baseURL: "http://localhost:11434/api",
                credentialMode: "optional",
                environmentKey: "OLLAMA_API_KEY",
                activeModelId: "local",
                models: [
                  {
                    id: "local",
                    name: "Local model",
                    modelId: "gemma3",
                    contextTokenBudget: 32768,
                    temperature: 0.5,
                    maxOutputTokens: 4096,
                    timeoutMs: 180000
                  }
                ]
              }
            }
          });

        assert.equal(
          resolved.provider,
          "ollama"
        );
        assert.equal(
          resolved.providerId,
          "ollama"
        );
        assert.equal(
          resolved.credentialMode,
          "optional"
        );
        assert.equal(
          resolved.model,
          "gemma3"
        );
      }
    );
  }
);
