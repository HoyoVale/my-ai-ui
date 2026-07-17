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
  memories = []
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
    latest.includes(
      "memory-key"
    )
  ) {
    return memories.length > 0
      ? `E2E_MEMORY:${memories[0].content}`
      : "E2E_MEMORY_NONE";
  }

  return (
    `E2E_REPLY_${userMessages.length}:` +
    latest
  );
}

export async function streamE2EResponse({
  messages,
  memories = [],
  signal,
  onChunk
}) {
  const text =
    buildE2EResponse(
      messages,
      memories
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
