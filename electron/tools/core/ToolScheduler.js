import path from "node:path";

import {
  ToolConcurrencyGuard
} from "./ToolConcurrencyGuard.js";

const PLAN_TOOLS = new Set([
  "update_plan",
  "replan_goal",
  "update_step_work"
]);

const PATH_READ_TOOLS = new Set([
  "read_text_file",
  "stat_path",
  "inspect_path",
  "compute_file_hash"
]);

const PATH_WRITE_TOOLS = new Set([
  "write_text_file",
  "replace_text_in_file",
  "append_text_file",
  "delete_path",
  "create_directory"
]);

const WORKSPACE_SCAN_TOOLS = new Set([
  "list_directory",
  "list_directory_tree",
  "search_files",
  "search_text",
  "detect_project"
]);

function normalizedPath(value, { caseInsensitive = false } = {}) {
  const source = String(value ?? "").trim().replace(/\\/gu, "/");
  if (!source) return "";
  const normalized = path.posix.normalize(source).replace(/^\.\//u, "");
  const trimmed = normalized === "." ? "" : normalized.replace(/\/+$/u, "");
  return caseInsensitive ? trimmed.toLocaleLowerCase("en-US") : trimmed;
}

function workspacePrefix(context = {}) {
  return `workspace:${String(context.workspaceId ?? "default").replace(/:/gu, "_")}`;
}

function pathResource(context, value, mode) {
  const normalized = normalizedPath(value, {
    caseInsensitive: context.platform === "win32" || process.platform === "win32"
  });
  return normalized
    ? {
        key: `${workspacePrefix(context)}:path:${normalized}`,
        mode
      }
    : {
        key: `${workspacePrefix(context)}:all:`,
        mode
      };
}

function resourcesForTool(definition = {}, input = {}, context = {}) {
  const name = String(definition.name ?? "");
  if (PLAN_TOOLS.has(name)) {
    return {
      barrier: true,
      resources: [{
        key: "__global__",
        mode: "exclusive"
      }]
    };
  }

  if (PATH_READ_TOOLS.has(name)) {
    return {
      resources: [pathResource(context, input.path, "shared")]
    };
  }

  if (name === "read_multiple_files") {
    return {
      resources: (Array.isArray(input.paths) ? input.paths : [])
        .map((item) => pathResource(context, item, "shared"))
    };
  }

  if (name === "compare_files") {
    return {
      resources: [
        pathResource(context, input.leftPath ?? input.left, "shared"),
        pathResource(context, input.rightPath ?? input.right, "shared")
      ]
    };
  }

  if (PATH_WRITE_TOOLS.has(name)) {
    return {
      resources: [pathResource(context, input.path, "exclusive")]
    };
  }

  if (name === "move_path") {
    return {
      resources: [
        pathResource(context, input.source ?? input.sourcePath ?? input.from ?? input.path, "exclusive"),
        pathResource(context, input.destination ?? input.destinationPath ?? input.to, "exclusive")
      ]
    };
  }

  if (name === "apply_patch" || name === "run_workspace_command") {
    return {
      barrier: true,
      resources: [{
        key: `${workspacePrefix(context)}:all:`,
        mode: "exclusive"
      }]
    };
  }

  if (["list_directory", "list_directory_tree"].includes(name)) {
    return {
      resources: [pathResource(context, input.path, "shared")]
    };
  }

  if (WORKSPACE_SCAN_TOOLS.has(name) || name === "git_diff") {
    return {
      resources: [{
        key: `${workspacePrefix(context)}:all:`,
        mode: "shared"
      }]
    };
  }

  if (name === "git_inspect") {
    return {
      resources: [{
        key: `git:${String(context.workspaceId ?? "default")}`,
        mode: "shared"
      }]
    };
  }

  const concurrencyKey = typeof definition.concurrencyKey === "function"
    ? String(definition.concurrencyKey(input) ?? "")
    : String(definition.concurrencyKey ?? "");
  return {
    resources: concurrencyKey
      ? [{ key: concurrencyKey, mode: "exclusive" }]
      : []
  };
}

export class ToolScheduler {
  constructor({
    maxConcurrent = 4,
    guard = null,
    context = {}
  } = {}) {
    this.guard = guard ?? new ToolConcurrencyGuard({ maxConcurrent });
    this.context = { ...context };
  }

  policyFor(definition, input) {
    const policy = resourcesForTool(definition, input, this.context);
    if (definition?.exclusiveConcurrency !== true) {
      return policy;
    }
    const resources = [
      ...(Array.isArray(policy.resources) ? policy.resources : []),
      { key: "__global__", mode: "exclusive" }
    ];
    return {
      ...policy,
      barrier: true,
      resources
    };
  }

  acquire(definition, input, signal = null) {
    const policy = this.policyFor(definition, input);
    return this.guard.acquire(
      definition?.name ?? "",
      signal,
      {
        resources: policy.resources,
        barrier: policy.barrier === true,
        exclusive: false
      }
    );
  }

  snapshot() {
    return this.guard.snapshot();
  }
}

export {
  resourcesForTool as resolveToolSchedulerPolicy
};
