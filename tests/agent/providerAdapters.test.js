import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import {
  generateText
} from "ai";

import {
  createSdkModel,
  normalizeOllamaBaseURL
} from "../../electron/agent/providers/sdkProviderRegistry.js";

function baseSettings(overrides = {}) {
  return {
    provider: "openai-compatible",
    providerId: "compatible",
    providerName: "Compatible",
    baseURL: "https://api.example.com/v1",
    model: "test-model",
    apiMode: "chat",
    contextTokenBudget: 32768,
    temperature: 0.7,
    topP: 1,
    seed: null,
    maxOutputTokens: 1024,
    maxRetries: 0,
    timeoutMs: 30000,
    reasoningMode: "auto",
    reasoningEffort: "default",
    reasoningBudgetTokens: 4096,
    textVerbosity: "default",
    ...overrides
  };
}

describe(
  "official provider SDK registry",
  () => {
    it(
      "uses the OpenAI-compatible SDK and maps usage",
      async () => {
        let request;

        const runtime = createSdkModel({
          modelSettings: baseSettings(),
          apiKey: "secret",
          fetchImplementation:
            async (url, options) => {
              request = {
                url,
                headers: options.headers,
                body: JSON.parse(options.body)
              };

              return new Response(
                JSON.stringify({
                  id: "response-1",
                  object: "chat.completion",
                  created: 1,
                  model: "test-model",
                  choices: [
                    {
                      index: 0,
                      message: {
                        role: "assistant",
                        content: "Connected"
                      },
                      finish_reason: "stop"
                    }
                  ],
                  usage: {
                    prompt_tokens: 12,
                    completion_tokens: 3,
                    total_tokens: 15
                  }
                }),
                {
                  status: 200,
                  headers: {
                    "content-type":
                      "application/json"
                  }
                }
              );
            }
        });

        const result = await generateText({
          model: runtime.model,
          prompt: "Hello",
          maxOutputTokens: 64,
          maxRetries: 0
        });

        assert.equal(
          request.url,
          "https://api.example.com/v1/chat/completions"
        );
        assert.equal(
          request.body.model,
          "test-model"
        );
        assert.equal(
          result.text,
          "Connected"
        );
        assert.equal(
          result.usage.inputTokens,
          12
        );
        assert.equal(
          result.usage.outputTokens,
          3
        );
      }
    );

    it(
      "uses the Anthropic SDK Messages endpoint",
      async () => {
        let request;

        const runtime = createSdkModel({
          modelSettings: baseSettings({
            provider: "anthropic",
            providerId: "anthropic",
            baseURL:
              "https://api.anthropic.com/v1",
            model:
              "claude-sonnet-4-6",
            apiMode: "messages"
          }),
          apiKey: "anthropic-secret",
          fetchImplementation:
            async (url, options) => {
              request = {
                url,
                body: JSON.parse(options.body)
              };

              return new Response(
                JSON.stringify({
                  id: "msg_1",
                  type: "message",
                  role: "assistant",
                  model:
                    "claude-sonnet-4-6",
                  content: [
                    {
                      type: "text",
                      text: "Connected"
                    }
                  ],
                  stop_reason: "end_turn",
                  stop_sequence: null,
                  usage: {
                    input_tokens: 10,
                    output_tokens: 2
                  }
                }),
                {
                  status: 200,
                  headers: {
                    "content-type":
                      "application/json"
                  }
                }
              );
            }
        });

        const result = await generateText({
          model: runtime.model,
          prompt: "Hello",
          maxOutputTokens: 32,
          maxRetries: 0
        });

        assert.equal(
          request.url,
          "https://api.anthropic.com/v1/messages"
        );
        assert.equal(
          request.body.model,
          "claude-sonnet-4-6"
        );
        assert.equal(
          result.text,
          "Connected"
        );
      }
    );

    it(
      "uses the native Ollama SDK and migrates /v1 to /api",
      async () => {
        let request;

        const runtime = createSdkModel({
          modelSettings: baseSettings({
            provider: "ollama",
            providerId: "ollama",
            baseURL:
              "http://localhost:11434/v1",
            model: "qwen3:4b",
            reasoningMode: "enabled"
          }),
          apiKey: "",
          fetchImplementation:
            async (url, options) => {
              request = {
                url,
                body: JSON.parse(options.body)
              };

              return new Response(
                JSON.stringify({
                  model: "qwen3:4b",
                  created_at:
                    "2026-01-01T00:00:00Z",
                  message: {
                    role: "assistant",
                    content: "Connected"
                  },
                  done: true,
                  done_reason: "stop",
                  prompt_eval_count: 5,
                  eval_count: 1
                }),
                {
                  status: 200,
                  headers: {
                    "content-type":
                      "application/json"
                  }
                }
              );
            }
        });

        const result = await generateText({
          model: runtime.model,
          prompt: "Hello",
          maxOutputTokens: 32,
          maxRetries: 0,
          providerOptions:
            runtime.providerOptions
        });

        assert.equal(
          normalizeOllamaBaseURL(
            "http://localhost:11434/v1"
          ),
          "http://localhost:11434/api"
        );
        assert.equal(
          request.url,
          "http://localhost:11434/api/chat"
        );
        assert.equal(
          request.body.think,
          true
        );
        assert.equal(
          result.text,
          "Connected"
        );
      }
    );
  }
);
