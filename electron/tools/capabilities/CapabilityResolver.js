import {
  CAPABILITY_SCHEMA_VERSION,
  CAPABILITY_TAXONOMY_HASH,
  CAPABILITY_TAXONOMY_VERSION,
  createEnvironmentPermissionEnvelope,
  getCapabilityDefinition,
  intersectPermissionEnvelopes,
  listCapabilityDefinitions,
  normalizeCapabilityIds,
  normalizePermissionEnvelope,
  permissionDecisionForCapabilities
} from "./CapabilityTaxonomy.js";

const SOURCE_PRIORITY = Object.freeze({
  built_in: 0,
  mcp: 1,
  custom_http: 2,
  plugin: 3,
  unknown: 4
});

function sourceKind(tool = {}) {
  const declared = String(tool.capabilitySourceKind ?? tool.sourceKind ?? "");
  if (["built_in", "builtin"].includes(declared)) return "built_in";
  if (declared === "mcp") return "mcp";
  if (["custom_http", "custom"].includes(declared)) return "custom_http";
  if (declared === "plugin") return "plugin";
  const source = String(tool.source ?? "");
  if (source.startsWith("builtin.")) return "built_in";
  if (source.startsWith("mcp.")) return "mcp";
  if (source.startsWith("custom.http.")) return "custom_http";
  if (source.startsWith("plugin.")) return "plugin";
  return "unknown";
}

function toolReady(tool = {}) {
  return (
    tool.ready !== false &&
    tool.available !== false &&
    tool.effectiveEnabled !== false
  );
}

function compareProviders(left, right) {
  const sourceDifference =
    (SOURCE_PRIORITY[sourceKind(left)] ?? SOURCE_PRIORITY.unknown) -
    (SOURCE_PRIORITY[sourceKind(right)] ?? SOURCE_PRIORITY.unknown);
  if (sourceDifference !== 0) return sourceDifference;
  return String(left.name ?? "").localeCompare(String(right.name ?? ""));
}

function normalizedRequest(request = {}) {
  return {
    requiredCapabilities: normalizeCapabilityIds(
      request.requiredCapabilities ?? [],
      { allowUnknown: true }
    ),
    optionalCapabilities: normalizeCapabilityIds(
      request.optionalCapabilities ?? [],
      { allowUnknown: true }
    ),
    permissions: normalizePermissionEnvelope(request.permissions ?? {}, "allow")
  };
}

function processOverrideEnabled(settings = {}) {
  return settings.tools?.developer?.toolsetOverrides?.["workspace.exec"] === "enabled";
}

export function resolveCapabilitySet({
  tools = [],
  mode = "chat",
  workspaceAvailable = false,
  settings = {},
  request = {}
} = {}) {
  const normalized = normalizedRequest(request);
  const environmentPermissions = createEnvironmentPermissionEnvelope({
    mode,
    workspaceAvailable,
    processEnabled: processOverrideEnabled(settings),
    settings
  });
  const effectivePermissions = intersectPermissionEnvelopes(
    environmentPermissions,
    normalized.permissions
  );
  const toolDecisions = {};
  const providers = new Map();

  for (const tool of tools ?? []) {
    const capabilities = normalizeCapabilityIds(tool.capabilities ?? []);
    const capabilityPermission = permissionDecisionForCapabilities(
      capabilities,
      effectivePermissions
    );
    const supplementalPermissions = Array.isArray(tool.permissionRequirements)
      ? tool.permissionRequirements.filter((key) => key in effectivePermissions)
      : [];
    const deniedSupplemental = supplementalPermissions.filter(
      (key) => effectivePermissions[key] === "deny"
    );
    const approvalSupplemental = supplementalPermissions.filter(
      (key) => effectivePermissions[key] === "ask"
    );
    const permission = {
      allowed: capabilityPermission.allowed && deniedSupplemental.length === 0,
      requiresApproval:
        capabilityPermission.allowed &&
        deniedSupplemental.length === 0 &&
        (capabilityPermission.requiresApproval || approvalSupplemental.length > 0),
      permissions: [
        ...new Set([
          ...capabilityPermission.permissions,
          ...supplementalPermissions
        ])
      ].sort(),
      denied: [
        ...new Set([
          ...capabilityPermission.denied,
          ...deniedSupplemental
        ])
      ].sort(),
      approval: [
        ...new Set([
          ...capabilityPermission.approval,
          ...approvalSupplemental
        ])
      ].sort()
    };
    const ready = toolReady(tool) && permission.allowed;
    toolDecisions[String(tool.name ?? "")] = {
      allowed: permission.allowed,
      requiresApproval: permission.requiresApproval,
      ready,
      permissions: permission.permissions,
      deniedPermissions: permission.denied,
      approvalPermissions: permission.approval
    };

    for (const capabilityId of capabilities) {
      const capabilityDefinition = getCapabilityDefinition(capabilityId);
      const modeAllowed = capabilityDefinition?.modes?.includes(
        mode === "coding" ? "coding" : "chat"
      ) !== false;
      const list = providers.get(capabilityId) ?? [];
      list.push({
        name: String(tool.name ?? ""),
        id: String(tool.id ?? ""),
        title: String(tool.displayTitle ?? tool.title ?? tool.name ?? ""),
        source: String(tool.source ?? ""),
        sourceKind: sourceKind(tool),
        ready: ready && modeAllowed,
        modeAllowed,
        permission
      });
      providers.set(capabilityId, list);
    }
  }

  for (const list of providers.values()) {
    list.sort(compareProviders);
  }

  const requestedIds = new Set([
    ...normalized.requiredCapabilities,
    ...normalized.optionalCapabilities
  ]);
  const capabilityEntries = listCapabilityDefinitions().map((definition) => {
    const availableProviders = (providers.get(definition.id) ?? [])
      .map((provider) => structuredClone(provider));
    const readyProviders = availableProviders.filter((provider) => provider.ready);
    const preferredSourceKind = readyProviders[0]?.sourceKind ?? null;
    const selectedProviders = preferredSourceKind
      ? readyProviders.filter((provider) => provider.sourceKind === preferredSourceKind)
      : [];
    return {
      ...definition,
      requested: requestedIds.has(definition.id),
      required: normalized.requiredCapabilities.includes(definition.id),
      optional: normalized.optionalCapabilities.includes(definition.id),
      registered: availableProviders.length > 0,
      available: readyProviders.length > 0,
      providers: availableProviders,
      selectedProviders,
      selectedProvider: selectedProviders[0] ?? null
    };
  });

  const byId = new Map(capabilityEntries.map((entry) => [entry.id, entry]));
  const missingRequired = normalized.requiredCapabilities.filter(
    (id) => byId.get(id)?.available !== true
  );
  const unavailableOptional = normalized.optionalCapabilities.filter(
    (id) => byId.get(id)?.available !== true
  );
  const selectedToolNames = [
    ...new Set(
      capabilityEntries
        .filter((entry) => entry.requested && entry.selectedProviders.length > 0)
        .flatMap((entry) => entry.selectedProviders.map((provider) => provider.name))
    )
  ];

  if (requestedIds.size === 0) {
    for (const [name, decision] of Object.entries(toolDecisions)) {
      if (decision.ready) selectedToolNames.push(name);
    }
  }

  const uniqueSelectedTools = [...new Set(selectedToolNames)].sort();
  const registeredCount = capabilityEntries.filter((entry) => entry.registered).length;
  const availableCount = capabilityEntries.filter((entry) => entry.available).length;

  return {
    schemaVersion: CAPABILITY_SCHEMA_VERSION,
    taxonomyVersion: CAPABILITY_TAXONOMY_VERSION,
    taxonomyHash: CAPABILITY_TAXONOMY_HASH,
    mode: mode === "coding" ? "coding" : "chat",
    workspaceAvailable: workspaceAvailable === true,
    permissions: {
      environment: environmentPermissions,
      requested: normalized.permissions,
      effective: effectivePermissions
    },
    request: normalized,
    satisfied: missingRequired.length === 0,
    missingRequired,
    unavailableOptional,
    selectedToolNames: uniqueSelectedTools,
    summary: {
      total: capabilityEntries.length,
      registered: registeredCount,
      available: availableCount,
      requested: requestedIds.size,
      required: normalized.requiredCapabilities.length,
      missingRequired: missingRequired.length
    },
    capabilities: capabilityEntries,
    toolDecisions
  };
}

export function resolveCapabilityRequirements(options = {}) {
  return resolveCapabilitySet(options);
}

export function capabilityDefinition(id) {
  return getCapabilityDefinition(id);
}
