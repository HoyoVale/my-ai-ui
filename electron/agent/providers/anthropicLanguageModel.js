import {
  convertPromptToAnthropic,
  createSseStream,
  emptyUsage,
  makeUsage,
  readError,
  responseHeaders
} from "./sharedLanguageModel.js";

function finishReason(raw) {
  const unified = {
    end_turn: "stop",
    stop_sequence: "stop",
    max_tokens: "length",
    tool_use: "tool-calls",
    refusal: "content-filter"
  }[raw] ?? "other";

  return {
    unified,
    raw: raw ?? undefined
  };
}

function anthropicUsage(usage) {
  if (!usage) {
    return emptyUsage(undefined);
  }

  return makeUsage({
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheRead:
      usage.cache_read_input_tokens,
    cacheWrite:
      usage.cache_creation_input_tokens,
    raw: usage
  });
}

export class AnthropicLanguageModel {
  constructor({
    modelId,
    baseURL,
    apiKey,
    headers = {},
    fetchImplementation = globalThis.fetch
  }) {
    this.specificationVersion = "v4";
    this.supportedUrls = {};
    this.provider = "anthropic.messages";
    this.modelId = modelId;
    this.baseURL = String(baseURL).replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.headers = headers;
    this.fetch = fetchImplementation;
  }

  buildBody(options, stream) {
    const prompt = convertPromptToAnthropic(
      options.prompt
    );

    return {
      model: this.modelId,
      system: prompt.system || undefined,
      messages: prompt.messages,
      max_tokens:
        options.maxOutputTokens ?? 4096,
      temperature: options.temperature,
      top_p: options.topP,
      stop_sequences:
        options.stopSequences,
      stream
    };
  }

  buildHeaders(extra = {}) {
    return {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": this.apiKey,
      ...this.headers,
      ...extra
    };
  }

  async doGenerate(options) {
    const body = this.buildBody(
      options,
      false
    );

    const response = await this.fetch(
      `${this.baseURL}/messages`,
      {
        method: "POST",
        headers: this.buildHeaders(
          options.headers
        ),
        body: JSON.stringify(body),
        signal: options.abortSignal
      }
    );

    if (!response.ok) {
      await readError(response);
    }

    const value = await response.json();
    const text = (value.content ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");

    return {
      content: text
        ? [{ type: "text", text }]
        : [],
      finishReason: finishReason(
        value.stop_reason
      ),
      usage: anthropicUsage(value.usage),
      request: { body },
      response: {
        id: value.id,
        modelId: value.model,
        headers: responseHeaders(response),
        body: value
      },
      warnings: []
    };
  }

  async doStream(options) {
    const body = this.buildBody(
      options,
      true
    );

    const response = await this.fetch(
      `${this.baseURL}/messages`,
      {
        method: "POST",
        headers: this.buildHeaders(
          options.headers
        ),
        body: JSON.stringify(body),
        signal: options.abortSignal
      }
    );

    if (!response.ok) {
      await readError(response);
    }

    let started = false;
    let rawFinishReason;
    let inputTokens;
    let outputTokens;
    let rawUsage;

    const stream = createSseStream({
      response,
      includeRawChunks:
        options.includeRawChunks,
      handleEvent: ({ event, data }, controller) => {
        let value;

        try {
          value = JSON.parse(data);
        } catch {
          return;
        }

        if (event === "error") {
          controller.enqueue({
            type: "error",
            error:
              value.error?.message ??
              value.error ??
              value
          });
          return;
        }

        if (event === "message_start") {
          inputTokens =
            value.message?.usage
              ?.input_tokens;
          outputTokens =
            value.message?.usage
              ?.output_tokens;
          rawUsage = value.message?.usage;

          controller.enqueue({
            type: "response-metadata",
            id: value.message?.id,
            modelId: value.message?.model
          });
          return;
        }

        if (event === "content_block_delta") {
          const delta = value.delta?.text;

          if (typeof delta === "string" && delta) {
            if (!started) {
              started = true;
              controller.enqueue({
                type: "text-start",
                id: "text-0"
              });
            }

            controller.enqueue({
              type: "text-delta",
              id: "text-0",
              delta
            });
          }
          return;
        }

        if (event === "message_delta") {
          rawFinishReason =
            value.delta?.stop_reason ??
            rawFinishReason;

          if (
            Number.isFinite(
              value.usage?.output_tokens
            )
          ) {
            outputTokens =
              value.usage.output_tokens;
          }

          rawUsage = {
            ...rawUsage,
            ...value.usage,
            input_tokens: inputTokens,
            output_tokens: outputTokens
          };
        }
      },
      finish: (controller) => {
        if (started) {
          controller.enqueue({
            type: "text-end",
            id: "text-0"
          });
        }

        controller.enqueue({
          type: "finish",
          finishReason:
            finishReason(rawFinishReason),
          usage: anthropicUsage({
            ...rawUsage,
            input_tokens: inputTokens,
            output_tokens: outputTokens
          })
        });
      }
    });

    return {
      stream,
      request: { body },
      response: {
        headers: responseHeaders(response)
      }
    };
  }
}
