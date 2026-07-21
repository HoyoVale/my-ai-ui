import crypto from "node:crypto";

export const CAPABILITY_SCHEMA_VERSION = 1;
export const CAPABILITY_TAXONOMY_VERSION = 1;

export const CAPABILITY_SOURCE_KINDS = Object.freeze([
  "built_in",
  "mcp",
  "custom_http",
  "plugin",
  "unknown"
]);

export const CAPABILITY_PERMISSION_LEVELS = Object.freeze([
  "deny",
  "ask",
  "allow"
]);

export const CAPABILITY_PERMISSION_KEYS = Object.freeze([
  "runtime",
  "workspaceRead",
  "workspaceWrite",
  "process",
  "network",
  "externalRead",
  "externalWrite",
  "destructive",
  "credential",
  "account",
  "agentInternal"
]);

const PERMISSION_RANK = Object.freeze({
  deny: 0,
  ask: 1,
  allow: 2
});

const DEFINITIONS = [
  {
    id: "runtime.info",
    title: "运行环境信息",
    description: "读取时间、日期、应用状态和经过净化的运行环境信息。",
    category: "runtime",
    modes: ["chat", "coding"],
    risk: "read",
    permissions: ["runtime"]
  },
  {
    id: "runtime.calculate",
    title: "安全计算",
    description: "执行受限数学和日期计算，不运行任意代码。",
    category: "runtime",
    modes: ["chat", "coding"],
    risk: "read",
    permissions: ["runtime"]
  },
  {
    id: "workspace.list",
    title: "浏览工作区",
    description: "列出授权工作区、目录和项目树。",
    category: "workspace",
    modes: ["chat", "coding"],
    risk: "read",
    permissions: ["workspaceRead"]
  },
  {
    id: "workspace.file.read",
    title: "读取工作区文件",
    description: "读取或检查授权工作区中的安全文件。",
    category: "workspace",
    modes: ["chat", "coding"],
    risk: "read",
    permissions: ["workspaceRead"]
  },
  {
    id: "workspace.file.search",
    title: "搜索工作区文件",
    description: "按路径、Glob、文本或受限正则搜索授权工作区。",
    category: "workspace",
    modes: ["chat", "coding"],
    risk: "read",
    permissions: ["workspaceRead"]
  },
  {
    id: "workspace.file.compare",
    title: "比较工作区文件",
    description: "比较文件、快照或修改前后的文本差异。",
    category: "workspace",
    modes: ["chat", "coding"],
    risk: "read",
    permissions: ["workspaceRead"]
  },
  {
    id: "workspace.file.create",
    title: "创建工作区内容",
    description: "在授权工作区内创建文件或目录。",
    category: "workspace",
    modes: ["coding"],
    risk: "local_write",
    permissions: ["workspaceWrite"]
  },
  {
    id: "workspace.file.modify",
    title: "修改工作区文件",
    description: "在授权工作区内覆盖、替换、追加或应用补丁。",
    category: "workspace",
    modes: ["coding"],
    risk: "local_write",
    permissions: ["workspaceWrite"]
  },
  {
    id: "workspace.file.move",
    title: "移动工作区路径",
    description: "在同一授权工作区内移动或重命名文件与目录。",
    category: "workspace",
    modes: ["coding"],
    risk: "local_write",
    permissions: ["workspaceWrite"]
  },
  {
    id: "workspace.file.delete",
    title: "删除工作区路径",
    description: "删除授权工作区中的文件或目录。",
    category: "workspace",
    modes: ["coding"],
    risk: "destructive",
    permissions: ["workspaceWrite", "destructive"]
  },
  {
    id: "workspace.project.inspect",
    title: "识别项目",
    description: "识别项目语言、依赖、包管理器、构建系统和脚本。",
    category: "workspace",
    modes: ["chat", "coding"],
    risk: "read",
    permissions: ["workspaceRead"]
  },
  {
    id: "git.read.status",
    title: "读取 Git 状态",
    description: "读取 Git 仓库状态、分支和受限历史信息。",
    category: "git",
    modes: ["chat", "coding"],
    risk: "read",
    permissions: ["workspaceRead"]
  },
  {
    id: "git.read.diff",
    title: "读取 Git 差异",
    description: "读取受限、脱敏且不执行外部 Diff 的 Git 差异。",
    category: "git",
    modes: ["chat", "coding"],
    risk: "read",
    permissions: ["workspaceRead"]
  },
  {
    id: "network.read",
    title: "网络读取",
    description: "通过受监管工具从网络读取数据。",
    category: "external",
    modes: ["chat", "coding"],
    risk: "network",
    permissions: ["network", "externalRead"]
  },
  {
    id: "external.read",
    title: "外部系统读取",
    description: "读取 MCP、HTTP 服务或其他外部系统中的数据。",
    category: "external",
    modes: ["chat", "coding"],
    risk: "read",
    permissions: ["externalRead"]
  },
  {
    id: "external.write",
    title: "外部系统写入",
    description: "修改外部系统、账户或远程资源。",
    category: "external",
    modes: ["chat", "coding"],
    risk: "external_write",
    permissions: ["externalWrite"]
  },
  {
    id: "process.execute",
    title: "执行受控进程",
    description: "运行开发者明确允许且由 Runtime 监管的进程。",
    category: "process",
    modes: ["coding"],
    risk: "process",
    permissions: ["process", "destructive"]
  },
  {
    id: "agent.plan",
    title: "维护任务计划",
    description: "更新当前 Agent Run 的结构化计划和步骤状态。",
    category: "agent",
    modes: ["chat", "coding"],
    risk: "read",
    permissions: ["agentInternal"]
  },
  {
    id: "agent.result.page",
    title: "读取分页工具结果",
    description: "读取当前 Agent Run 中被截断并安全存储的工具结果。",
    category: "agent",
    modes: ["chat", "coding"],
    risk: "read",
    permissions: ["agentInternal"]
  }
];

const TAXONOMY = new Map(
  DEFINITIONS.map((definition) => [
    definition.id,
    Object.freeze({
      ...definition,
      modes: Object.freeze([...definition.modes]),
      permissions: Object.freeze([...definition.permissions])
    })
  ])
);

function stableHash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 20);
}

export const CAPABILITY_TAXONOMY_HASH = stableHash({
  schemaVersion: CAPABILITY_SCHEMA_VERSION,
  taxonomyVersion: CAPABILITY_TAXONOMY_VERSION,
  definitions: DEFINITIONS
});

export function listCapabilityDefinitions() {
  return [...TAXONOMY.values()].map((definition) => structuredClone(definition));
}

export function getCapabilityDefinition(id) {
  const definition = TAXONOMY.get(String(id ?? ""));
  return definition ? structuredClone(definition) : null;
}

export function isKnownCapability(id) {
  return TAXONOMY.has(String(id ?? ""));
}

export function normalizeCapabilityIds(values = [], { allowUnknown = false } = {}) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [values])
        .map((value) => String(value ?? "").trim())
        .filter((value) => value && (allowUnknown || TAXONOMY.has(value)))
    )
  ].sort();
}

export function capabilityPermissionRequirements(values = []) {
  return [
    ...new Set(
      normalizeCapabilityIds(values)
        .flatMap((id) => TAXONOMY.get(id)?.permissions ?? [])
    )
  ].sort();
}

export function normalizePermissionLevel(value, fallback = "deny") {
  return CAPABILITY_PERMISSION_LEVELS.includes(value)
    ? value
    : CAPABILITY_PERMISSION_LEVELS.includes(fallback)
      ? fallback
      : "deny";
}

export function normalizePermissionEnvelope(value = {}, fallback = "allow") {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    CAPABILITY_PERMISSION_KEYS.map((key) => [
      key,
      normalizePermissionLevel(source[key], fallback)
    ])
  );
}

export function intersectPermissionEnvelopes(...values) {
  const envelopes = values.length > 0
    ? values.map((value) => normalizePermissionEnvelope(value, "allow"))
    : [normalizePermissionEnvelope({}, "allow")];

  return Object.fromEntries(
    CAPABILITY_PERMISSION_KEYS.map((key) => {
      const level = envelopes.reduce((current, envelope) => {
        const candidate = envelope[key];
        return PERMISSION_RANK[candidate] < PERMISSION_RANK[current]
          ? candidate
          : current;
      }, "allow");
      return [key, level];
    })
  );
}

export function createEnvironmentPermissionEnvelope({
  mode = "chat",
  workspaceAvailable = false,
  processEnabled = false,
  settings = {}
} = {}) {
  const approval = settings.tools?.security?.approval ?? {};
  const coding = mode === "coding";
  return normalizePermissionEnvelope({
    runtime: "allow",
    workspaceRead: workspaceAvailable ? "allow" : "deny",
    workspaceWrite:
      coding && workspaceAvailable
        ? approval.localWrite === false ? "allow" : "ask"
        : "deny",
    process: coding && processEnabled ? "ask" : "deny",
    network: "allow",
    externalRead: "allow",
    externalWrite: approval.remoteWrite === false ? "allow" : "ask",
    destructive: "ask",
    credential: "ask",
    account: "ask",
    agentInternal: "allow"
  });
}

export function permissionDecisionForCapabilities(
  capabilityIds = [],
  permissionEnvelope = {}
) {
  const permissions = capabilityPermissionRequirements(capabilityIds);
  const envelope = normalizePermissionEnvelope(permissionEnvelope, "deny");
  const denied = permissions.filter((key) => envelope[key] === "deny");
  const approval = permissions.filter((key) => envelope[key] === "ask");
  return {
    allowed: denied.length === 0,
    requiresApproval: denied.length === 0 && approval.length > 0,
    permissions,
    denied,
    approval
  };
}
