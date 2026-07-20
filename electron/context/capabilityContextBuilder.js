import {
  resolveEnabledToolCatalog,
  resolveToolMode
} from "../tools/toolCatalog.js";

function normalizedManifest(toolSettings, toolManifest) {
  const catalog =
    Array.isArray(toolManifest) && toolManifest.length > 0
      ? toolManifest
      : undefined;
  const enabled = resolveEnabledToolCatalog(toolSettings, catalog);
  const manifestByName = new Map(
    (Array.isArray(toolManifest) ? toolManifest : [])
      .map((item) => [item?.name, item])
  );

  return enabled.map((item) => {
    const manifest = manifestByName.get(item.name) ?? item;
    const toolset =
      manifest.toolset ??
      manifest.toolsetId ??
      manifest.toolsets?.[0] ??
      item.toolset ??
      item.toolsets?.[0] ??
      "core.runtime";
    const workspaceRead = toolset === "workspace.read";

    return {
      name: item.name,
      title:
        manifest.displayTitle ??
        manifest.presentation?.title ??
        manifest.title ??
        item.title ??
        item.name,
      source: manifest.source ?? item.source ?? "builtin",
      toolset,
      sideEffect:
        manifest.sideEffect ??
        (workspaceRead ? "read" : "none"),
      riskLevel:
        manifest.riskLevel ??
        (workspaceRead ? "low" : "none"),
      effect:
        manifest.runtimeContract?.effect ??
        manifest.sideEffect ??
        "read"
    };
  });
}

function capabilitySummary(tools) {
  const toolsets = new Set(tools.map((item) => item.toolset));
  const effects = new Set(tools.map((item) => item.sideEffect));
  const sources = new Set(tools.map((item) => item.source));
  const capabilities = [];

  if (effects.has("none")) capabilities.push("内部计算与任务控制");
  if (effects.has("read")) capabilities.push("读取已授权资源");
  if (effects.has("write")) capabilities.push("修改已授权资源");
  if (effects.has("external")) capabilities.push("调用外部服务或进程");

  return {
    toolsets,
    effects,
    sources,
    capabilities
  };
}

export function buildCapabilityContext({
  toolSettings = {},
  toolManifest = []
} = {}) {
  const mode = resolveToolMode(toolSettings);

  if (toolSettings.enabled === false) {
    return [
      `当前模式：${mode === "coding" ? "Coding" : "Chat"}。`,
      "本轮没有启用工具。",
      "没有文件、网络、浏览器、进程或外部平台操作能力；不要声称执行了任何外部操作。"
    ].join("\n");
  }

  const tools = normalizedManifest(toolSettings, toolManifest);
  const summary = capabilitySummary(tools);
  const elevated = tools.filter((item) =>
    ["medium", "high"].includes(item.riskLevel) ||
    ["write", "external", "local_write", "remote_write", "destructive"]
      .includes(item.effect)
  );

  const hasWorkspaceRead = summary.toolsets.has("workspace.read");
  const hasWorkspaceWrite = summary.toolsets.has("workspace.write");
  const hasProcess = summary.toolsets.has("workspace.exec");
  const hasMcp = [...summary.sources].some((source) =>
    String(source).startsWith("mcp.")
  );
  const hasBrowser = tools.some((tool) =>
    /browser|playwright/iu.test(`${tool.name} ${tool.source} ${tool.toolset}`)
  );
  const hasNetwork = hasMcp || tools.some((tool) =>
    /http|fetch|network|github|slack|notion/iu.test(
      `${tool.name} ${tool.source} ${tool.toolset}`
    )
  );

  const positive = [
    `当前模式：${mode === "coding" ? "Coding" : "Chat"}。`,
    `本轮提供 ${tools.length} 个工具；能力：${summary.capabilities.join("、") || "无"}。`,
    hasWorkspaceRead
      ? "可以读取绑定工作区内经过授权和边界检查的资源。"
      : "没有工作区读取能力。",
    hasWorkspaceWrite
      ? "可以通过受控工具修改绑定工作区；写入仍需 Runtime 校验和收据确认。"
      : "没有工作区写入能力。",
    hasProcess
      ? "可以使用受监管的工作区进程工具；没有任意 Shell 权限。"
      : "没有工作区进程或任意 Shell 能力。",
    hasNetwork
      ? "存在受控网络或外部平台能力；实际域名、仓库和权限以工具 Schema 与 Runtime 策略为准。"
      : "没有任意网络访问或外部平台能力。",
    hasBrowser
      ? "存在受控浏览器能力。"
      : "没有浏览器自动化能力。"
  ];

  if (elevated.length > 0) {
    positive.push(
      `可能产生副作用或需要额外策略检查的工具：${elevated
        .map((item) => `${item.title} (${item.name})`)
        .join(", ")}。`
    );
  } else {
    positive.push("当前启用的工具不声明写入或外部副作用。");
  }

  positive.push(
    "只能调用当前请求实际提供的 Tool Schema。每次调用仍必须通过 Runtime 的权限、预算、超时、熔断、审批和恢复策略；不要根据这段摘要推断未提供的能力。"
  );

  return positive.join("\n");
}
