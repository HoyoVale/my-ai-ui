import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import {
  resolveActiveModelSettings
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
