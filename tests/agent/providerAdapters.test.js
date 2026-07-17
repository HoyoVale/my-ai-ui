import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import {
  AnthropicLanguageModel
} from "../../electron/agent/providers/anthropicLanguageModel.js";

import {
  OpenAICompatibleLanguageModel
} from "../../electron/agent/providers/openAICompatibleLanguageModel.js";

function textPrompt() {
  return [
    {
      role: "system",
      content: "You are concise."
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Hello"
        }
      ]
    }
  ];
}

async function collectStream(stream) {
  const parts = [];

  for await (const part of stream) {
    parts.push(part);
  }

  return parts;
}

describe(
  "OpenAI-compatible language model adapter",
  () => {
    it(
      "generates text and maps standard usage",
      async () => {
        let request;

        const model =
          new OpenAICompatibleLanguageModel({
            provider: "openai",
            modelId: "gpt-test",
            baseURL: "https://api.example.com/v1/",
            apiKey: "secret",
            fetchImplementation:
              async (url, options) => {
                request = {
                  url,
                  options,
                  body: JSON.parse(
                    options.body
                  )
                };

                return new Response(
                  JSON.stringify({
                    id: "response-1",
                    model: "gpt-test",
                    choices: [
                      {
                        message: {
                          content: "Connected"
                        },
                        finish_reason: "stop"
                      }
                    ],
                    usage: {
                      prompt_tokens: 12,
                      completion_tokens: 3
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

        const result =
          await model.doGenerate({
            prompt: textPrompt(),
            maxOutputTokens: 64,
            temperature: 0.2
          });

        assert.equal(
          request.url,
          "https://api.example.com/v1/chat/completions"
        );
        assert.equal(
          request.options.headers
            .Authorization,
          "Bearer secret"
        );
        assert.equal(
          request.body.model,
          "gpt-test"
        );
        assert.equal(
          request.body.messages[0]
            .role,
          "system"
        );
        assert.equal(
          result.content[0].text,
          "Connected"
        );
        assert.equal(
          result.usage.inputTokens
            .total,
          12
        );
        assert.equal(
          result.usage.outputTokens
            .total,
          3
        );
      }
    );

    it(
      "streams OpenAI-compatible text deltas",
      async () => {
        const encoder =
          new TextEncoder();

        const model =
          new OpenAICompatibleLanguageModel({
            provider: "ollama",
            modelId: "gemma3",
            baseURL:
              "http://localhost:11434/v1",
            apiKey: "",
            fetchImplementation:
              async () => {
                const stream =
                  new ReadableStream({
                    start(controller) {
                      controller.enqueue(
                        encoder.encode(
                          'data: {"id":"1","model":"gemma3","choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}\n\n'
                        )
                      );
                      controller.enqueue(
                        encoder.encode(
                          'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1}}\n\n'
                        )
                      );
                      controller.enqueue(
                        encoder.encode(
                          "data: [DONE]\n\n"
                        )
                      );
                      controller.close();
                    }
                  });

                return new Response(
                  stream,
                  {
                    status: 200,
                    headers: {
                      "content-type":
                        "text/event-stream"
                    }
                  }
                );
              }
          });

        const result =
          await model.doStream({
            prompt: textPrompt(),
            maxOutputTokens: 64
          });

        const parts =
          await collectStream(
            result.stream
          );

        assert.equal(
          parts.find(
            (part) =>
              part.type ===
              "text-delta"
          ).delta,
          "Hi"
        );
        assert.equal(
          parts.at(-1).type,
          "finish"
        );
        assert.equal(
          parts.at(-1).usage
            .inputTokens.total,
          5
        );
      }
    );
  }
);

describe(
  "Anthropic Messages adapter",
  () => {
    it(
      "uses the native Messages endpoint and Anthropic headers",
      async () => {
        let request;

        const model =
          new AnthropicLanguageModel({
            modelId:
              "claude-sonnet-4-20250514",
            baseURL:
              "https://api.anthropic.com/v1/",
            apiKey: "anthropic-secret",
            fetchImplementation:
              async (url, options) => {
                request = {
                  url,
                  options,
                  body: JSON.parse(
                    options.body
                  )
                };

                return new Response(
                  JSON.stringify({
                    id: "msg_1",
                    model:
                      "claude-sonnet-4-20250514",
                    content: [
                      {
                        type: "text",
                        text: "Connected"
                      }
                    ],
                    stop_reason: "end_turn",
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

        const result =
          await model.doGenerate({
            prompt: textPrompt(),
            maxOutputTokens: 32
          });

        assert.equal(
          request.url,
          "https://api.anthropic.com/v1/messages"
        );
        assert.equal(
          request.options.headers[
            "x-api-key"
          ],
          "anthropic-secret"
        );
        assert.equal(
          request.options.headers[
            "anthropic-version"
          ],
          "2023-06-01"
        );
        assert.equal(
          request.body.system,
          "You are concise."
        );
        assert.equal(
          result.content[0].text,
          "Connected"
        );
        assert.equal(
          result.usage.outputTokens
            .total,
          2
        );
      }
    );
  }
);
