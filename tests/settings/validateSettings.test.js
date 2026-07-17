import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import {
  sanitizeSettings
} from "../../electron/settings/validateSettings.js";

describe(
  "conversation settings validation",
  () => {
    it(
      "clamps conversation limits",
      () => {
        const settings =
          sanitizeSettings({
            conversation: {
              contextTurns: 999,
              contextTokenBudget: 9999999,
              maxConversations: 1,
              autoTitle: "yes",
              saveAbortedReplies:
                false
            }
          });

        assert.equal(
          settings
            .conversation
            .contextTurns,
          50
        );

        assert.equal(
          "contextTokenBudget" in
            settings.conversation,
          false
        );

        assert.equal(
          settings
            .conversation
            .maxConversations,
          10
        );

        assert.equal(
          settings
            .conversation
            .autoTitle,
          true
        );

        assert.equal(
          settings
            .conversation
            .saveAbortedReplies,
          false
        );
      }
    );
  }
);


describe(
  "removed conversation window settings",
  () => {
    it(
      "ignores legacy conversationWindow configuration",
      () => {
        const settings =
          sanitizeSettings({
            conversationWindow: {
              sidebarWidth: 999,
              alwaysOnTop: true
            }
          });

        assert.equal(
          "conversationWindow" in settings,
          false
        );
      }
    );
  }
);


describe(
  "memory settings validation",
  () => {
    it(
      "clamps memory retrieval settings",
      () => {
        const settings =
          sanitizeSettings({
            memory: {
              enabled: false,
              maxInjected: 999,
              minPriority: -4
            }
          });

        assert.equal(
          settings.memory.enabled,
          false
        );
        assert.equal(
          settings.memory.maxInjected,
          20
        );
        assert.equal(
          settings.memory.minPriority,
          0
        );
      }
    );

    it(
      "migrates legacy minImportance to minPriority",
      () => {
        const settings =
          sanitizeSettings({
            memory: {
              minImportance: 0.65
            }
          });

        assert.equal(
          settings.memory.minPriority,
          0.65
        );
        assert.equal(
          "minImportance" in
            settings.memory,
          false
        );
      }
    );
  }
);


describe(
  "personality settings validation",
  () => {
    it(
      "sanitizes personality identity and response preferences",
      () => {
        const settings =
          sanitizeSettings({
            personality: {
              enabled: true,
              name: "  Nova  ",
              identity: "  桌面研究助手  ",
              language: "invalid",
              tone: "professional",
              responseLength: "detailed",
              customInstructions:
                "  先给结论。  "
            }
          });

        assert.equal(
          settings.personality.name,
          "Nova"
        );
        assert.equal(
          settings.personality.identity,
          "桌面研究助手"
        );
        assert.equal(
          settings.personality.language,
          "auto"
        );
        assert.equal(
          settings.personality.tone,
          "professional"
        );
        assert.equal(
          settings.personality.responseLength,
          "detailed"
        );
        assert.equal(
          settings.personality.customInstructions,
          "先给结论。"
        );
      }
    );
  }
);


describe(
  "multi-model settings validation",
  () => {
    it(
      "keeps multiple DeepSeek models and selects the requested one",
      () => {
        const settings =
          sanitizeSettings({
            model: {
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
                      maxOutputTokens: 4096,
                      temperature: 0.4,
                      timeoutMs: 60000
                    },
                    {
                      id: "pro",
                      name: "Pro",
                      modelId: "deepseek-v4-pro",
                      contextTokenBudget: 1000000,
                      maxOutputTokens: 32768,
                      temperature: 0.8,
                      timeoutMs: 120000
                    }
                  ]
                }
              }
            }
          });

        const provider =
          settings.model.providers.deepseek;

        assert.equal(
          provider.models.length,
          2
        );
        assert.equal(
          provider.activeModelId,
          "pro"
        );
        assert.equal(
          provider.models[1]
            .contextTokenBudget,
          1000000
        );
      }
    );

    it(
      "migrates legacy flat model and conversation token budget",
      () => {
        const settings =
          sanitizeSettings({
            conversation: {
              contextTokenBudget: 128000
            },
            model: {
              provider: "deepseek",
              model: "legacy-model",
              baseURL: "https://example.com/v1",
              temperature: 0.2,
              maxOutputTokens: 8192,
              timeoutMs: 45000
            }
          });

        const provider =
          settings.model.providers.deepseek;
        const model =
          provider.models[0];

        assert.equal(
          model.modelId,
          "legacy-model"
        );
        assert.equal(
          model.contextTokenBudget,
          128000
        );
        assert.equal(
          provider.baseURL,
          "https://example.com/v1"
        );
        assert.equal(
          "contextTokenBudget" in
            settings.conversation,
          false
        );
      }
    );
  }
);
