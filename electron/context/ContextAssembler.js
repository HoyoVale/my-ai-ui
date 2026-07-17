import {
  buildShortTermContext
} from "../conversation/contextBuilder.js";

import {
  buildMemoryContext
} from "../memory/memoryContextBuilder.js";

import {
  BASE_SYSTEM_CONTEXT
} from "./baseSystemContext.js";

import {
  buildPersonalityContext,
  getPersonalitySummary
} from "./personalityContextBuilder.js";

export function assembleAgentContext({
  settings,
  conversation,
  memories = []
} = {}) {
  const normalizedSettings =
    settings ?? {};

  const messages =
    buildShortTermContext({
      messages:
        conversation?.messages ??
        [],
      maxTurns:
        normalizedSettings
          .conversation
          ?.contextTurns ?? 8
    });

  const personalityContext =
    buildPersonalityContext(
      normalizedSettings
        .personality
    );

  const memoryContext =
    normalizedSettings
      .memory
      ?.enabled === false
      ? ""
      : buildMemoryContext(
          memories
        );

  const system = [
    BASE_SYSTEM_CONTEXT,
    personalityContext,
    memoryContext
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    system,
    messages,
    metadata: {
      personality:
        getPersonalitySummary(
          normalizedSettings
            .personality
        ),
      memoryCount:
        memoryContext
          ? memories.length
          : 0,
      messageCount:
        messages.length,
      contextTurns:
        normalizedSettings
          .conversation
          ?.contextTurns ?? 8
    }
  };
}
