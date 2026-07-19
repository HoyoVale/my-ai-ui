import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  resolveEnabledToolCatalog,
  resolveToolProfileId
} from "../tools/toolCatalog.js";

import {
  getWorkspacePolicySummary
} from "../tools/workspace/workspacePolicy.js";

let packageVersion = null;

const DEFAULT_ENVIRONMENT = {
  enabled: true,
  profile: "standard",
  includeTime: true,
  includeLocale: true,
  includeSystem: true,
  includeApplication: true,
  includeRuntimeVersions: false,
  includeModel: true,
  includeWorkspace: true,
  includeTools: true,
  workspaceDetail: "summary",
  toolDetail: "profile"
};

function readPackageVersion() {
  if (packageVersion) {
    return packageVersion;
  }

  try {
    const packagePath = path.resolve(
      process.cwd(),
      "package.json"
    );

    const data = JSON.parse(
      fs.readFileSync(
        packagePath,
        "utf8"
      )
    );

    packageVersion =
      String(data.version ?? "0.0.0");
  } catch {
    packageVersion = "0.0.0";
  }

  return packageVersion;
}

export function getLocalTimezone() {
  return (
    Intl.DateTimeFormat()
      .resolvedOptions()
      .timeZone || "UTC"
  );
}

export function getRuntimeLocale() {
  return (
    Intl.DateTimeFormat()
      .resolvedOptions()
      .locale || "en-US"
  );
}

export function createRuntimeSnapshot({
  now = new Date(),
  activeModel = null,
  workspaceSummary = null,
  workspaceSettings = {},
  toolSettings = {}
} = {}) {
  const timezone =
    getLocalTimezone();

  const locale =
    getRuntimeLocale();

  const localDateTime =
    new Intl.DateTimeFormat(
      "sv-SE",
      {
        timeZone: timezone,
        dateStyle: "short",
        timeStyle: "medium",
        hourCycle: "h23"
      }
    ).format(now);

  const offsetText =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone: timezone,
        timeZoneName: "longOffset"
      }
    )
      .formatToParts(now)
      .find(
        (part) =>
          part.type ===
          "timeZoneName"
      )
      ?.value ?? "GMT";

  const workspace =
    workspaceSummary ??
    getWorkspacePolicySummary(
      workspaceSettings
    );
  const enabledTools =
    resolveEnabledToolCatalog(
      toolSettings
    ).filter(
      (item) =>
        item.toolset !== "workspace.read" ||
        workspace !== null
    );

  return {
    currentDate:
      localDateTime.slice(0, 10),
    localDateTime,
    utcDateTime:
      now.toISOString(),
    timezone,
    utcOffset: offsetText,
    locale,
    operatingSystem: {
      platform: process.platform,
      release: os.release(),
      architecture: process.arch
    },
    application: {
      name: "Xixi Desktop",
      version:
        readPackageVersion(),
      development:
        process.env.NODE_ENV !==
        "production"
    },
    runtime: {
      node:
        process.versions.node,
      electron:
        process.versions.electron ??
        null,
      chromium:
        process.versions.chrome ??
        null
    },
    activeModel:
      activeModel
        ? {
            providerId:
              activeModel.providerId,
            providerName:
              activeModel.providerName,
            modelName:
              activeModel.modelName,
            modelId:
              activeModel.model,
            contextTokenBudget:
              activeModel
                .contextTokenBudget
          }
        : null,
    workspace,
    toolProfile: {
      id: resolveToolProfileId(
        toolSettings
      ),
      enabled:
        toolSettings.enabled !==
        false,
      count: enabledTools.length,
      tools: enabledTools.map(
        (item) => item.name
      )
    }
  };
}

function workspaceLine(
  snapshot,
  detail
) {
  if (detail === "hidden") {
    return null;
  }

  const roots =
    snapshot.workspace?.roots ?? [];

  if (detail === "full") {
    return `只读工作区：${roots.join("; ") || "未配置"}`;
  }

  return roots.length > 0
    ? `只读工作区：已授权 ${roots.length} 个目录，具体路径可通过 get_workspace_info 查询`
    : "只读工作区：未配置";
}

function toolLine(
  snapshot,
  detail
) {
  if (detail === "hidden") {
    return null;
  }

  if (detail === "names") {
    return `工具配置：${snapshot.toolProfile.id}；可用工具：${snapshot.toolProfile.tools.join(", ") || "无"}`;
  }

  return `工具配置：${snapshot.toolProfile.id}；可用 ${snapshot.toolProfile.count} 个低风险工具`;
}

export function buildRuntimeContextSection({
  contextSettings = {},
  toolSettings = {},
  workspaceSettings =
    toolSettings.workspace ?? {},
  ...options
} = {}) {
  const environment = {
    ...DEFAULT_ENVIRONMENT,
    ...(contextSettings
      .environment ??
      contextSettings)
  };

  if (environment.enabled === false) {
    return "";
  }

  const snapshot =
    createRuntimeSnapshot({
      ...options,
      toolSettings,
      workspaceSettings
    });

  const lines = [
    "# 当前运行环境（由应用实时提供）"
  ];

  if (environment.includeTime) {
    lines.push(
      `当前本地日期：${snapshot.currentDate}`,
      `当前本地时间：${snapshot.localDateTime}`,
      `UTC 时间：${snapshot.utcDateTime}`,
      `时区：${snapshot.timezone} (${snapshot.utcOffset})`
    );
  }

  if (environment.includeLocale) {
    lines.push(
      `区域语言：${snapshot.locale}`
    );
  }

  if (environment.includeSystem) {
    lines.push(
      `操作系统：${snapshot.operatingSystem.platform} ${snapshot.operatingSystem.release} (${snapshot.operatingSystem.architecture})`
    );
  }

  if (environment.includeApplication) {
    lines.push(
      `应用：${snapshot.application.name} ${snapshot.application.version}`
    );

    if (
      environment.includeRuntimeVersions
    ) {
      lines.push(
        `运行时：Node ${snapshot.runtime.node}；Electron ${snapshot.runtime.electron ?? "未知"}；Chromium ${snapshot.runtime.chromium ?? "未知"}`
      );
    }
  }

  if (environment.includeModel) {
    const modelLine =
      snapshot.activeModel
        ? `${snapshot.activeModel.providerName} / ${snapshot.activeModel.modelName} (${snapshot.activeModel.modelId})，上下文上限 ${snapshot.activeModel.contextTokenBudget}`
        : "未解析";

    lines.push(
      `当前模型：${modelLine}`
    );
  }

  if (environment.includeWorkspace) {
    const line = workspaceLine(
      snapshot,
      environment.workspaceDetail
    );

    if (line) {
      lines.push(line);
    }
  }

  if (environment.includeTools) {
    const line = toolLine(
      snapshot,
      environment.toolDetail
    );

    if (line) {
      lines.push(line);
    }
  }

  lines.push(
    "时间、日期、计算、系统状态或文件内容需要精确答案时，应调用对应工具，不要依赖训练记忆猜测。"
  );

  return lines.join("\n");
}
