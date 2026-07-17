import {
  convertPromptToOpenAI,
  createSseStream,
  emptyUsage,
  makeUsage,
  readError,
  responseHeaders
} from "./sharedLanguageModel.js";

function finishReason(raw) {
  const unified = {
    stop: "stop",
    length: "length",
    content_filter: "content-filter",
    tool_calls: "tool-calls"
  }[raw] ?? "other";

  return {
    unified,
    raw: raw ?? undefined
  };
}

function openAIUsage(usage) {
  if (!usage) {
    return emptyUsage(undefined);
  }

  return makeUsage({
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    cacheRead:
      usage.prompt_tokens_details
        ?.cached_tokens,
    raw: usage
  });
}

export class OpenAICompatibleLanguageModel {
  constructor({
    provider,
    modelId,
    baseURL,
    apiKey,
    headers = {},
    fetchImplementation = globalThis.fetch
  }) {
    this.specificationVersion = "v4";
    this.supportedUrls = {};
    this.provider = `${provider}.chat`;
    this.modelId = modelId;
    this.baseURL = String(baseURL).replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.headers = headers;
    this.fetch = fetchImplementation;
  }

  buildBody(options, stream) {
    return {
      model: this.modelId,
      messages: convertPromptToOpenAI(
        options.prompt
      ),
      max_tokens:
        options.maxOutputTokens,
      temperature: options.temperature,
      top_p: options.topP,
      frequency_penalty:
        options.frequencyPenalty,
      presence_penalty:
        options.presencePenalty,
      stop: options.stopSequences,
      stream,
      ...(stream
        ? {
            stream_options: {
              include_usage: true
            }
          }
        : {})
    };
  }

  buildHeaders(extra = {}) {
    return {
      "content-type": "application/json",
      ...(this.apiKey
        ? {
            Authorization: `Bearer ${this.apiKey}`
          }
        : {}),
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
      `${this.baseURL}/chat/completions`,
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
    const choice = value.choices?.[0] ?? {};
    const text =
      choice.message?.content ?? "";

    return {
      content: text
        ? [{ type: "text", text }]
        : [],
      finishReason: finishReason(
        choice.finish_reason
      ),
      usage: openAIUsage(value.usage),
      request: { body },
      response: {
        id: value.id,
        modelId: value.model,
        timestamp:
          Number.isFinite(value.created)
            ? new Date(value.created * 1000)
            : undefined,
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
      `${this.baseURL}/chat/completions`,
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
    let metadataSent = false;
    let rawFinishReason;
    let usage;

    const stream = createSseStream({
      response,
      includeRawChunks:
        options.includeRawChunks,
      handleEvent: ({ data }, controller) => {
        if (data === "[DONE]") {
          return;
        }

        let value;

        try {
          value = JSON.parse(data);
        } catch {
          return;
        }

        if (value.error) {
          controller.enqueue({
            type: "error",
            error:
              value.error.message ??
              value.error
          });
          return;
        }

        if (!metadataSent) {
          metadataSent = true;
          controller.enqueue({
            type: "response-metadata",
            id: value.id,
            modelId: value.model,
            timestamp:
              Number.isFinite(value.created)
                ? new Date(
                    value.created * 1000
                  )
                : undefined
          });
        }

        if (value.usage) {
          usage = value.usage;
        }

        const choice = value.choices?.[0];
        const delta = choice?.delta?.content;

        if (choice?.finish_reason) {
          rawFinishReason =
            choice.finish_reason;
        }

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
          usage: openAIUsage(usage)
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
