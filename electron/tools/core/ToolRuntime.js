import {
  ToolExecutor
} from "./ToolExecutor.js";
import {
  ToolRegistry,
  ToolRegistrySnapshot
} from "./ToolRegistry.js";

function resolveSnapshot(registry, definitions) {
  if (registry instanceof ToolRegistrySnapshot) {
    return registry;
  }
  if (registry instanceof ToolRegistry) {
    return registry.snapshot();
  }

  const created = new ToolRegistry();
  created.registerMany(definitions ?? []);
  return created.freeze();
}

export class ToolRuntime {
  constructor({
    registry = null,
    definitions = [],
    executor = null,
    executorOptions = {}
  } = {}) {
    this.registry = resolveSnapshot(registry, definitions);
    this.executor = executor ?? new ToolExecutor(executorOptions);
  }

  get(name) {
    return this.registry.get(name);
  }

  list() {
    return this.registry.list();
  }

  manifest() {
    return this.registry.manifest();
  }

  async invoke(name, input, options = {}) {
    const definition = this.registry.get(name);
    if (!definition) {
      return {
        ok: false,
        error: {
          code: "TOOL_NOT_FOUND",
          type: "NOT_FOUND",
          category: "not_found",
          message: `Tool is not registered: ${String(name ?? "")}`,
          retryable: false
        }
      };
    }
    return this.executor.execute(definition, input, options);
  }

  getRecords() {
    return this.executor.getRecords();
  }

  getEvents() {
    return this.executor.getEvents();
  }

  getBudget() {
    return this.executor.getBudget();
  }

  getCallCount() {
    return this.executor.getCallCount();
  }
}
