import * as internals from "../PlatformKernelInternals.js";

import {
  projectPlatformExecutionBridge,
  validatePlatformExecutionBridge
} from "../../execution-model/PlatformExecutionBridge.js";

export const PlatformExecutionBridgeService = {
  getExecutionBridge(platformRunId) {
    const run = this.ensureLoaded().runs[internals.text(platformRunId, 120)];
    return run ? projectPlatformExecutionBridge(run) : null;
  },

  getAgentExecutionThread(platformRunId, agentRunId) {
    const bridge = this.getExecutionBridge(platformRunId);
    if (!bridge) return null;
    const binding = bridge.bindings[internals.text(agentRunId, 120)];
    if (!binding) return null;
    return bridge.children.find((thread) => thread.id === binding.threadId) ?? null;
  },

  validateExecutionBridge(platformRunId) {
    const run = this.ensureLoaded().runs[internals.text(platformRunId, 120)];
    return run
      ? validatePlatformExecutionBridge(run)
      : { ok: false, errors: ["platform-run-not-found"] };
  }
};
