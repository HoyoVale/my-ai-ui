export function isE2EMode() {
  return (
    process.env.XIXI_E2E ===
    "1"
  );
}


export function getE2EToolWriteRequest(messages = []) {
  const latest = [...messages]
    .reverse()
    .find((message) => message?.role === "user")
    ?.content;

  if (latest !== "tool-write-key") {
    return null;
  }

  return {
    path: "e2e-approved.txt",
    content: "E2E approved write\n"
  };
}

function wait(
  milliseconds,
  signal
) {
  return new Promise(
    (resolve, reject) => {
      let settled = false;
      let timer = null;

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }

        signal?.removeEventListener(
          "abort",
          abort
        );
      };

      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        resolve();
      };

      const abort = () => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();

        const error =
          new Error(
            "E2E generation aborted."
          );

        error.name =
          "AbortError";

        reject(error);
      };

      if (signal?.aborted) {
        abort();
        return;
      }

      signal?.addEventListener(
        "abort",
        abort,
        {
          once: true
        }
      );

      timer = setTimeout(
        finish,
        milliseconds
      );
    }
  );
}

export function buildE2EResponse(
  messages,
  memories = [],
  contextMetadata = {}
) {
  const userMessages =
    messages.filter(
      (message) =>
        message.role === "user"
    );

  const latest =
    userMessages.at(-1)
      ?.content ??
    "";

  if (
    contextMetadata
      .regeneration === true
  ) {
    return (
      `E2E_REGENERATED_${userMessages.length}:` +
      latest
    );
  }

  if (
    latest.includes(
      "memory-key"
    )
  ) {
    return memories.length > 0
      ? `E2E_MEMORY:${memories[0].content}`
      : "E2E_MEMORY_NONE";
  }

  if (
    latest.includes(
      "model-key"
    )
  ) {
    const activeModel =
      contextMetadata
        .activeModel ?? {};

    return [
      "E2E_MODEL",
      activeModel.modelName ?? "",
      activeModel.modelId ?? "",
      activeModel.contextTokenBudget ?? 0
    ].join(":");
  }

  if (
    latest.includes(
      "latex-key"
    )
  ) {
    return [
      "Inline: $E = mc^2$",
      "",
      "$$",
      "\\int_0^1 x^2 \\, dx = \\frac{1}{3}",
      "$$"
    ].join("\n");
  }

  if (
    latest.includes(
      "personality-key"
    )
  ) {
    const personality =
      contextMetadata
        .personality ?? {};

    return personality.enabled
      ? `E2E_PERSONALITY:${personality.name}:${personality.tone}:${personality.responseLength}`
      : "E2E_PERSONALITY_DISABLED";
  }

  if (latest === "second message") {
    return [
      `E2E_REPLY_${userMessages.length}:${latest}`,
      "",
      "```js",
      "console.log(\"markdown\");",
      "```",
      "",
      "| 项目 | 状态 |",
      "| --- | --- |",
      "| Markdown | ready |"
    ].join("\n");
  }

  if (latest.startsWith("e2e-long-stream")) {
    const lines = Array.from(
      { length: 180 },
      (_, index) =>
        `E2E_LONG_STREAM_LINE_${String(index + 1).padStart(3, "0")}:` +
        " renderer-reload-window-recreate-persistence-check"
    );

    return [
      `E2E_LONG_STREAM_BEGIN:${latest}`,
      ...lines,
      `E2E_LONG_STREAM_END:${latest}`
    ].join("\n");
  }

  return (
    `E2E_REPLY_${userMessages.length}:` +
    latest
  );
}

export async function streamE2EResponse({
  messages,
  memories = [],
  contextMetadata = {},
  signal,
  onChunk
}) {
  const text =
    buildE2EResponse(
      messages,
      memories,
      contextMetadata
    );

  const latest = [...messages]
    .reverse()
    .find((message) => message?.role === "user")
    ?.content ?? "";

  const longStream =
    latest.startsWith("e2e-long-stream");

  const requestedChunkCount = Number(
    process.env.XIXI_E2E_LONG_STREAM_CHUNKS
  );

  const chunkCount = longStream
    ? Math.max(
        24,
        Number.isFinite(requestedChunkCount)
          ? Math.min(500, Math.round(requestedChunkCount))
          : 180
      )
    : 3;

  const requestedDelay = Number(
    process.env.XIXI_E2E_LONG_STREAM_DELAY_MS
  );

  const chunkDelayMs = longStream
    ? Math.max(
        1,
        Number.isFinite(requestedDelay)
          ? Math.min(250, Math.round(requestedDelay))
          : 15
      )
    : 35;

  const chunkSize =
    Math.max(
      1,
      Math.ceil(
        text.length / chunkCount
      )
    );

  for (
    let index = 0;
    index < text.length;
    index += chunkSize
  ) {
    await wait(
      chunkDelayMs,
      signal
    );

    onChunk(
      text.slice(
        index,
        index + chunkSize
      )
    );
  }

  return text;
}
