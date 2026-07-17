function asText(content = []) {
  let text = "";

  for (const part of content) {
    if (part?.type === "text") {
      text += part.text ?? "";
    } else if (part?.type === "reasoning") {
      continue;
    } else if (part?.type === "tool-result") {
      text += JSON.stringify(part.output ?? "");
    }
  }

  return text;
}

export function convertPromptToOpenAI(prompt = []) {
  return prompt.map((message) => {
    if (message.role === "system") {
      return {
        role: "system",
        content: message.content
      };
    }

    if (message.role === "tool") {
      return {
        role: "user",
        content: asText(message.content)
      };
    }

    return {
      role: message.role,
      content: asText(message.content)
    };
  });
}

export function convertPromptToAnthropic(prompt = []) {
  const system = [];
  const messages = [];

  for (const message of prompt) {
    if (message.role === "system") {
      system.push(message.content);
      continue;
    }

    if (message.role === "tool") {
      messages.push({
        role: "user",
        content: asText(message.content)
      });
      continue;
    }

    messages.push({
      role: message.role,
      content: asText(message.content)
    });
  }

  return {
    system: system.join("\n\n"),
    messages
  };
}

export function emptyUsage(raw) {
  return {
    inputTokens: {
      total: undefined,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined
    },
    outputTokens: {
      total: undefined,
      text: undefined,
      reasoning: undefined
    },
    raw
  };
}

export function makeUsage({
  inputTokens,
  outputTokens,
  cacheRead,
  cacheWrite,
  raw
} = {}) {
  return {
    inputTokens: {
      total:
        Number.isFinite(inputTokens)
          ? inputTokens
          : undefined,
      noCache:
        Number.isFinite(inputTokens)
          ? Math.max(
              0,
              inputTokens -
                (Number.isFinite(cacheRead)
                  ? cacheRead
                  : 0)
            )
          : undefined,
      cacheRead:
        Number.isFinite(cacheRead)
          ? cacheRead
          : undefined,
      cacheWrite:
        Number.isFinite(cacheWrite)
          ? cacheWrite
          : undefined
    },
    outputTokens: {
      total:
        Number.isFinite(outputTokens)
          ? outputTokens
          : undefined,
      text:
        Number.isFinite(outputTokens)
          ? outputTokens
          : undefined,
      reasoning: undefined
    },
    raw
  };
}

export function responseHeaders(response) {
  return Object.fromEntries(
    response.headers.entries()
  );
}

export async function readError(response) {
  let details = "";

  try {
    const body = await response.json();
    details =
      body?.error?.message ??
      body?.message ??
      JSON.stringify(body);
  } catch {
    try {
      details = await response.text();
    } catch {
      details = "";
    }
  }

  throw new Error(
    `${response.status} ${response.statusText}${
      details ? `：${details}` : ""
    }`
  );
}

export function createSseStream({
  response,
  warnings = [],
  includeRawChunks = false,
  handleEvent,
  finish
}) {
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";

  const emitEvent = (
    event,
    controller
  ) => {
    if (!event) {
      return;
    }

    if (includeRawChunks) {
      controller.enqueue({
        type: "raw",
        rawValue: event
      });
    }

    handleEvent(event, controller);
  };

  return new ReadableStream({
    async start(controller) {
      controller.enqueue({
        type: "stream-start",
        warnings
      });

      try {
        while (true) {
          const { value, done } =
            await reader.read();

          if (value) {
            buffer += decoder
              .decode(value, {
                stream: !done
              })
              .replace(/\r\n/g, "\n");
          }

          let boundary;

          while (
            (boundary =
              buffer.indexOf("\n\n")) >= 0
          ) {
            const block = buffer.slice(
              0,
              boundary
            );

            buffer = buffer.slice(
              boundary + 2
            );

            emitEvent(
              parseSseBlock(block),
              controller
            );
          }

          if (done) {
            if (buffer.trim()) {
              emitEvent(
                parseSseBlock(buffer),
                controller
              );
            }

            finish(controller);
            controller.close();
            return;
          }
        }
      } catch (error) {
        controller.enqueue({
          type: "error",
          error
        });
        controller.close();
      }
    },

    async cancel(reason) {
      await reader.cancel(reason);
    }
  });
}

function parseSseBlock(block) {
  const lines = block.split("\n");
  let event = "message";
  const data = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data.push(line.slice(5).trimStart());
    }
  }

  if (data.length === 0) {
    return null;
  }

  return {
    event,
    data: data.join("\n")
  };
}
