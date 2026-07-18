import { tool } from "ai";

export function supportsStrictToolSchemas(activeModel = {}) {
  if (typeof activeModel.supportsStrictToolSchemas === "boolean") {
    return activeModel.supportsStrictToolSchemas;
  }
  return activeModel.provider === "openai";
}

export function createAiSdkToolSet(
  definitions,
  execute,
  { supportsStrictSchemas = false } = {}
) {
  return Object.fromEntries(
    definitions.map((definition) => [
      definition.name,
      tool({
        description: definition.description,
        inputSchema: definition.inputSchema,
        strict:
          definition.strict ?? Boolean(supportsStrictSchemas),
        execute: (input, options) => execute(definition, input, options)
      })
    ])
  );
}
