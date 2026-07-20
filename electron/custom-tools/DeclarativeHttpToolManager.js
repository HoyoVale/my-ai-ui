import {
  createDeclarativeHttpDefinition,
  executeDeclarativeHttpTool
} from "./declarativeHttpTool.js";

async function defaultSecretResolver(toolId) {
  const module = await import("./customHttpCredentialStore.js");
  return module.getCustomHttpSecret(toolId);
}

export class DeclarativeHttpToolManager {
  constructor({
    secretResolver = defaultSecretResolver,
    fetchImpl = fetch
  } = {}) {
    this.secretResolver = secretResolver;
    this.fetchImpl = fetchImpl;
  }

  getConfigs(settings = {}, { includeDisabled = false } = {}) {
    if (settings.customTools?.enabled === false && !includeDisabled) {
      return [];
    }
    return (settings.customTools?.tools ?? [])
      .filter((tool) =>
        tool.url &&
        (includeDisabled || tool.enabled !== false) &&
        (includeDisabled || tool.method !== "DELETE" || tool.allowDestructive === true)
      );
  }

  getToolDefinitions(settings = {}, options = {}) {
    return this.getConfigs(settings, options).map((config) =>
      createDeclarativeHttpDefinition(config, {
        secretResolver: this.secretResolver,
        fetchImpl: this.fetchImpl
      })
    );
  }

  snapshot(settings = {}) {
    const tools = settings.customTools?.tools ?? [];
    return {
      enabled: settings.customTools?.enabled !== false,
      tools: tools.map((tool) => ({
        id: tool.id,
        name: tool.name,
        enabled: tool.enabled !== false,
        method: tool.method,
        url: tool.url,
        authMode: tool.authMode,
        valid: Boolean(tool.url)
      }))
    };
  }

  async testConfig(config, input = {}) {
    if (!config?.id) {
      throw new Error("自定义 HTTP 工具配置无效。");
    }
    return executeDeclarativeHttpTool(config, input, {
      secret: await this.secretResolver(config.id),
      fetchImpl: this.fetchImpl
    });
  }

  async testTool(settings = {}, toolId, input = {}) {
    const config = (settings.customTools?.tools ?? []).find(
      (tool) => tool.id === String(toolId ?? "")
    );
    if (!config) {
      throw new Error("未找到自定义 HTTP 工具。");
    }
    return this.testConfig(config, input);
  }
}

export const declarativeHttpToolManager = new DeclarativeHttpToolManager();
