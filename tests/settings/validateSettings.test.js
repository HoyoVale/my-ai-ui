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


describe(
  "provider expansion settings validation",
  () => {
    it(
      "keeps built-in providers and sanitizes a custom compatible provider",
      () => {
        const settings =
          sanitizeSettings({
            model: {
              activeProvider: "custom-gateway",
              providers: {
                "custom-gateway": {
                  id: "custom-gateway",
                  type: "openai-compatible",
                  name: "  Team Gateway  ",
                  baseURL: "https://gateway.example.com/v1/",
                  credentialMode: "optional",
                  environmentKey: "team_gateway_key",
                  activeModelId: "chat",
                  models: [
                    {
                      id: "chat",
                      name: "Team Chat",
                      modelId: "team-chat",
                      contextTokenBudget: 256000,
                      maxOutputTokens: 16384,
                      temperature: 0.3,
                      timeoutMs: 90000
                    }
                  ]
                }
              }
            }
          });

        assert.deepEqual(
          Object.keys(
            settings.model.providers
          ),
          ["custom-gateway"]
        );

        assert.equal(
          settings.model.activeProvider,
          "custom-gateway"
        );

        const provider =
          settings.model.providers[
            "custom-gateway"
          ];

        assert.equal(
          provider.name,
          "Team Gateway"
        );
        assert.equal(
          provider.baseURL,
          "https://gateway.example.com/v1"
        );
        assert.equal(
          provider.environmentKey,
          "TEAM_GATEWAY_KEY"
        );
        assert.equal(
          provider.models[0]
            .contextTokenBudget,
          256000
        );
      }
    );
  }
);


describe(
  "typography settings validation",
  () => {
    it(
      "uses one global font family with per-window size and density",
      () => {
        const settings =
          sanitizeSettings({
            appearance: {
              fontFamily: "custom",
              customFontFamily:
                "  Atkinson Hyperlegible  ",
              typography: {
                conversation: {
                  fontSize: 19,
                  lineHeight: 1.9,
                  density: "spacious"
                },
                memory: {
                  fontSize: 9,
                  lineHeight: 9,
                  density: "invalid"
                }
              }
            }
          });

        assert.equal(
          settings.appearance.fontFamily,
          "custom"
        );
        assert.equal(
          settings.appearance
            .customFontFamily,
          "Atkinson Hyperlegible"
        );
        assert.equal(
          settings.appearance.typography
            .conversation.fontSize,
          19
        );
        assert.equal(
          settings.appearance.typography
            .conversation.lineHeight,
          1.9
        );
        assert.equal(
          settings.appearance.typography
            .conversation.density,
          "spacious"
        );
        assert.equal(
          settings.appearance.typography
            .conversation.contentWidth,
          768
        );
        assert.equal(
          settings.appearance.typography
            .memory.fontSize,
          10
        );
        assert.equal(
          settings.appearance.typography
            .memory.lineHeight,
          2.4
        );
        assert.equal(
          settings.appearance.typography
            .memory.density,
          "comfortable"
        );
      }
    );

    it(
      "migrates legacy Input and Response typography fields",
      () => {
        const settings =
          sanitizeSettings({
            input: {
              fontSize: 18
            },
            response: {
              fontSize: 17,
              lineHeight: 1.8
            }
          });

        assert.equal(
          settings.appearance.typography
            .input.fontSize,
          18
        );
        assert.equal(
          settings.appearance.typography
            .response.fontSize,
          17
        );
        assert.equal(
          settings.appearance.typography
            .response.lineHeight,
          1.8
        );
      }
    );
  }
);

describe(
  "SDK model option validation",
  () => {
    it(
      "sanitizes advanced request options and migrates Ollama to its native API",
      () => {
        const settings = sanitizeSettings({
          model: {
            activeProvider: "ollama",
            providers: {
              ollama: {
                id: "ollama",
                type: "openai-compatible",
                name: "Ollama",
                baseURL: "http://localhost:11434/v1",
                credentialMode: "optional",
                activeModelId: "qwen",
                models: [
                  {
                    id: "qwen",
                    name: "Qwen",
                    modelId: "qwen3:4b",
                    apiMode: "chat",
                    contextTokenBudget: 32768,
                    temperature: 5,
                    topP: -1,
                    seed: "42",
                    maxOutputTokens: 4096,
                    maxRetries: 9,
                    timeoutMs: 120000,
                    reasoningMode: "enabled",
                    reasoningEffort: "high",
                    reasoningBudgetTokens: 2048,
                    textVerbosity: "high"
                  }
                ]
              }
            }
          }
        });

        const provider =
          settings.model.providers.ollama;
        const model = provider.models[0];

        assert.equal(provider.type, "ollama");
        assert.equal(
          provider.baseURL,
          "http://localhost:11434/api"
        );
        assert.equal(model.temperature, 2);
        assert.equal(model.topP, 0);
        assert.equal(model.seed, 42);
        assert.equal(model.maxRetries, 5);
        assert.equal(
          model.reasoningMode,
          "enabled"
        );
      }
    );
  }
);
