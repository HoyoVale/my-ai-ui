import {
  CAPABILITY_PERMISSION_KEYS,
  capabilityPermissionRequirements,
  normalizeCapabilityIds
} from "./CapabilityTaxonomy.js";

const BUILTIN_CAPABILITY_MAP = Object.freeze({
  get_current_time: ["runtime.info"],
  convert_time_zone: ["runtime.info"],
  calculate_date: ["runtime.info"],
  calculator: ["runtime.calculate"],
  get_runtime_info: ["runtime.info"],
  get_agent_status: ["runtime.info"],
  get_workspace_info: ["workspace.list"],
  list_directory: ["workspace.list"],
  list_directory_tree: ["workspace.list"],
  stat_path: ["workspace.file.read"],
  inspect_path: ["workspace.file.read"],
  read_text_file: ["workspace.file.read"],
  read_multiple_files: ["workspace.file.read"],
  compare_files: ["workspace.file.compare"],
  search_files: ["workspace.file.search"],
  search_text: ["workspace.file.search"],
  git_diff: ["git.read.diff"],
  detect_project: ["workspace.project.inspect"],
  compute_file_hash: ["workspace.file.read"],
  write_text_file: ["workspace.file.create", "workspace.file.modify"],
  replace_text_in_file: ["workspace.file.modify"],
  append_text_file: ["workspace.file.create", "workspace.file.modify"],
  create_directory: ["workspace.file.create"],
  move_path: ["workspace.file.move"],
  delete_path: ["workspace.file.delete"],
  apply_patch: ["workspace.file.create", "workspace.file.modify"],
  git_inspect: ["git.read.status", "git.read.diff"],
  run_workspace_command: ["process.execute"],
  update_plan: ["agent.plan"],
  update_step_work: ["agent.plan"],
  read_tool_result: ["agent.result.page"]
});

function declaredMcpCapabilities(definition) {
  const declared = definition.mcp?.annotations?.capabilities;
  return Array.isArray(declared)
    ? declared.map((value) => String(value ?? "").toLowerCase())
    : [];
}

function inferExternalCapabilities(definition) {
  const source = String(definition.source ?? "");
  const effect = String(
    definition.runtimeContract?.effect ??
    (definition.sideEffect === "write" ? "local_write" : "read")
  );
  const declared = declaredMcpCapabilities(definition);
  const network =
    source.startsWith("custom.http.") ||
    declared.includes("network") ||
    declared.includes("network.read");
  const capabilities = effect === "read"
    ? ["external.read", ...(network ? ["network.read"] : [])]
    : ["external.write"];
  const permissionRequirements = [
    ...capabilityPermissionRequirements(capabilities),
    ...(network ? ["network"] : [])
  ];

  return {
    capabilities: normalizeCapabilityIds(capabilities),
    permissionRequirements: [...new Set(permissionRequirements)].sort()
  };
}

export function inferToolCapabilities(definition = {}) {
  const declaredCapabilities = Array.isArray(definition.capabilities)
    ? [...new Set(definition.capabilities.map((value) => String(value ?? "").trim()).filter(Boolean))]
    : [];
  const explicit = normalizeCapabilityIds(declaredCapabilities);
  if (declaredCapabilities.length > 0 && explicit.length !== declaredCapabilities.length) {
    const unknown = declaredCapabilities.filter((id) => !explicit.includes(id));
    throw new TypeError(`Unknown Tool capability: ${unknown.join(", ")}`);
  }
  if (explicit.length > 0) {
    return {
      capabilities: explicit,
      evidence: "explicit",
      permissionRequirements: [
        ...new Set([
          ...capabilityPermissionRequirements(explicit),
          ...(Array.isArray(definition.permissionRequirements)
            ? definition.permissionRequirements
                .map(String)
                .filter((key) => CAPABILITY_PERMISSION_KEYS.includes(key))
            : [])
        ])
      ].sort()
    };
  }

  const builtin = normalizeCapabilityIds(
    BUILTIN_CAPABILITY_MAP[String(definition.name ?? "")] ?? []
  );
  if (builtin.length > 0) {
    return {
      capabilities: builtin,
      evidence: "builtin-map",
      permissionRequirements: capabilityPermissionRequirements(builtin)
    };
  }

  const source = String(definition.source ?? "");
  const external =
    source.startsWith("mcp.") || source.startsWith("custom.http.")
      ? inferExternalCapabilities(definition)
      : { capabilities: [], permissionRequirements: [] };
  if (external.capabilities.length > 0) {
    return {
      capabilities: external.capabilities,
      evidence: source.startsWith("mcp.") ? "mcp-inferred" : "custom-http-inferred",
      permissionRequirements: external.permissionRequirements
    };
  }

  const effect = String(definition.runtimeContract?.effect ?? "read");
  const fallback = normalizeCapabilityIds(
    effect === "read"
      ? source.startsWith("builtin.") || source === "builtin"
        ? ["runtime.info"]
        : ["external.read"]
      : ["external.write"]
  );
  return {
    capabilities: fallback,
    evidence: "runtime-fallback",
    permissionRequirements: capabilityPermissionRequirements(fallback)
  };
}

export function builtinCapabilityMap() {
  return structuredClone(BUILTIN_CAPABILITY_MAP);
}
