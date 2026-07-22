import fs from "node:fs";

const RUNTIME_FILES = Object.freeze({
  facade: "../../electron/agent/AgentRuntime.js",
  preparation: "../../electron/agent/preparation/AgentRunPreparation.js",
  execution: "../../electron/agent/execution/AgentRunExecution.js",
  finalization: "../../electron/agent/finalization/AgentRunFinalization.js",
  persistence: "../../electron/agent/persistence/AgentRunPersistence.js",
  internals: "../../electron/agent/AgentRuntimeInternals.js"
});

export function readAgentRuntimeSource(part = "all") {
  if (part !== "all") {
    const relativePath = RUNTIME_FILES[part];
    if (!relativePath) {
      throw new TypeError(`Unknown Agent Runtime source part: ${part}`);
    }
    return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
  }

  return Object.values(RUNTIME_FILES)
    .map((relativePath) => fs.readFileSync(new URL(relativePath, import.meta.url), "utf8"))
    .join("\n\n");
}

export function getAgentRuntimeSourceFiles() {
  return { ...RUNTIME_FILES };
}
