import {
  resolveEnabledToolCatalog
} from "../tools/toolCatalog.js";

function normalizedManifest(
  toolSettings,
  toolManifest
) {
  const catalog =
    Array.isArray(toolManifest) &&
    toolManifest.length > 0
      ? toolManifest
      : undefined;
  const enabled =
    resolveEnabledToolCatalog(
      toolSettings,
      catalog
    );
  const manifestByName =
    new Map(
      (Array.isArray(toolManifest)
        ? toolManifest
        : [])
        .map((item) => [
          item?.name,
          item
        ])
    );

  return enabled.map((item) => {
    const manifest =
      manifestByName.get(
        item.name
      ) ?? item;
    const workspaceRead =
      item.toolset ===
      "workspace.read";

    return {
      name: item.name,
      sideEffect:
        manifest.sideEffect ??
        (workspaceRead
          ? "read"
          : "none"),
      riskLevel:
        manifest.riskLevel ??
        (workspaceRead
          ? "low"
          : "none")
    };
  });
}

export function buildCapabilityContext({
  toolSettings = {},
  toolManifest = []
} = {}) {
  if (toolSettings.enabled === false) {
    return [
      "本轮没有启用工具。",
      "不要声称执行了任何外部操作。"
    ].join("\n");
  }

  const tools =
    normalizedManifest(
      toolSettings,
      toolManifest
    );
  const sideEffects =
    new Set(
      tools.map((item) =>
        item.sideEffect
      )
    );
  const capabilities = [];

  if (
    sideEffects.has("none")
  ) {
    capabilities.push(
      "内部计算与任务控制"
    );
  }
  if (
    sideEffects.has("read")
  ) {
    capabilities.push(
      "读取已授权资源"
    );
  }
  if (
    sideEffects.has("write")
  ) {
    capabilities.push(
      "修改已授权资源"
    );
  }
  if (
    sideEffects.has("external")
  ) {
    capabilities.push(
      "调用外部服务"
    );
  }

  const elevated =
    tools.filter((item) =>
      ["medium", "high"].includes(
        item.riskLevel
      ) ||
      ["write", "external"].includes(
        item.sideEffect
      )
    );

  return [
    `本轮提供 ${tools.length} 个工具；能力：${capabilities.join("、") || "无"}。`,
    elevated.length > 0
      ? `可能产生副作用或需要额外策略检查的工具：${elevated.map((item) => item.name).join(", ")}。`
      : "当前启用的工具不声明写入或外部副作用。",
    "只能调用当前请求实际提供的工具 Schema。每次调用仍必须通过 Runtime 的权限、预算、超时和审批策略；不要根据这段摘要推断未提供的能力。"
  ].join("\n");
}
