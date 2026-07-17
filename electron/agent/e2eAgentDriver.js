export function isE2EMode() {
  return (
    process.env.XIXI_E2E ===
    "1"
  );
}

function wait(
  milliseconds,
  signal
) {
  return new Promise(
    (resolve, reject) => {
      const timer =
        setTimeout(
          resolve,
          milliseconds
        );

      const abort = () => {
        clearTimeout(timer);

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

  const chunkSize =
    Math.max(
      1,
      Math.ceil(
        text.length / 3
      )
    );

  for (
    let index = 0;
    index < text.length;
    index += chunkSize
  ) {
    await wait(
      35,
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
