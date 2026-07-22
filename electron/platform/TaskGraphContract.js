import {
  sha256
} from "./canonical.js";

export const TASK_GRAPH_SCHEMA_VERSION = 2;

export const SUPERVISOR_ROLES = Object.freeze([
  "planner",
  "explorer",
  "implementer",
  "tester",
  "reviewer",
  "evaluator",
  "integrator",
  "replanner"
]);

const ROLE_SET = new Set(SUPERVISOR_ROLES);

const ROLE_CAPABILITIES = Object.freeze({
  planner: [
    "workspace.list",
    "workspace.file.read",
    "workspace.file.search",
    "workspace.project.inspect",
    "git.read.status",
    "git.read.diff"
  ],
  explorer: [
    "workspace.list",
    "workspace.file.read",
    "workspace.file.search",
    "workspace.file.compare",
    "workspace.project.inspect",
    "git.read.status",
    "git.read.diff"
  ],
  implementer: [
    "workspace.list",
    "workspace.file.read",
    "workspace.file.search",
    "workspace.file.compare",
    "workspace.file.create",
    "workspace.file.modify",
    "workspace.project.inspect",
    "git.read.status",
    "git.read.diff",
    "process.execute"
  ],
  tester: [
    "workspace.list",
    "workspace.file.read",
    "workspace.file.search",
    "workspace.file.compare",
    "workspace.project.inspect",
    "git.read.status",
    "git.read.diff",
    "process.execute"
  ],
  reviewer: [
    "workspace.list",
    "workspace.file.read",
    "workspace.file.search",
    "workspace.file.compare",
    "workspace.project.inspect",
    "git.read.status",
    "git.read.diff",
    "process.execute"
  ],
  evaluator: [
    "workspace.list",
    "workspace.file.read",
    "workspace.file.search",
    "workspace.file.compare",
    "workspace.project.inspect",
    "git.read.status",
    "git.read.diff",
    "process.execute"
  ],
  integrator: [
    "workspace.list",
    "workspace.file.read",
    "workspace.file.compare",
    "git.read.status",
    "git.read.diff"
  ],
  replanner: [
    "workspace.list",
    "workspace.file.read",
    "workspace.file.search",
    "workspace.project.inspect",
    "git.read.status",
    "git.read.diff"
  ]
});

const READ_ONLY_ROLES = new Set([
  "planner",
  "explorer",
  "tester",
  "reviewer",
  "evaluator",
  "replanner"
]);

function text(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function integer(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function normalizeStringList(values, maxItems = 40, maxLength = 160) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => text(value, maxLength))
      .filter(Boolean)
  )].slice(0, maxItems);
}

function normalizeAcceptanceCriteria(values = []) {
  const ids = new Set();
  return (Array.isArray(values) ? values : [])
    .map((criterion, index) => {
      const source = typeof criterion === "string"
        ? { text: criterion }
        : criterion && typeof criterion === "object"
          ? criterion
          : {};
      const criterionText = text(source.text ?? source.objective, 500);
      if (!criterionText) return null;
      const base = text(source.id, 120) || `acceptance-${index + 1}`;
      let id = base;
      let suffix = 2;
      while (ids.has(id)) {
        id = `${base.slice(0, 110)}-${suffix++}`;
      }
      ids.add(id);
      return {
        id,
        text: criterionText,
        verificationKind: text(source.verificationKind, 80) || "evaluator"
      };
    })
    .filter(Boolean)
    .slice(0, 16);
}

function normalizeResourceLocks(values = []) {
  const locks = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const source = typeof value === "string" ? { key: value } : value;
    const key = text(source?.key ?? source?.resourceKey, 500);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    locks.push({
      key,
      mode: source?.mode === "shared" ? "shared" : "exclusive"
    });
    if (locks.length >= 16) break;
  }
  return locks;
}

function normalizeWorkspaceScope(value, role) {
  const source = value && typeof value === "object" ? value : {};
  return {
    kind: text(source.kind, 40) || "workspace",
    path: text(source.path, 1000),
    writable: READ_ONLY_ROLES.has(role) ? false : source.writable !== false
  };
}

export function defaultCapabilitiesForRole(role) {
  return [...(ROLE_CAPABILITIES[ROLE_SET.has(role) ? role : "implementer"] ?? [])];
}

export function isReadOnlySupervisorRole(role) {
  return READ_ONLY_ROLES.has(role);
}

export function normalizeTaskDefinition(task = {}, {
  createId = () => "",
  defaultRole = "implementer"
} = {}) {
  const role = ROLE_SET.has(task?.role) ? task.role : defaultRole;
  const id = text(task?.taskId ?? task?.id, 120) || text(createId(), 120);
  const requiredCapabilities = normalizeStringList(
    Array.isArray(task?.requiredCapabilities) && task.requiredCapabilities.length > 0
      ? task.requiredCapabilities
      : defaultCapabilitiesForRole(role),
    32,
    120
  );
  return {
    schemaVersion: TASK_GRAPH_SCHEMA_VERSION,
    id,
    title: text(task?.title, 500) || text(task?.objective, 500) || "未命名任务",
    objective: text(task?.objective, 2000) || text(task?.title, 2000) || "未命名任务",
    parentTaskId: text(task?.parentTaskId, 120) || null,
    role,
    instructions: text(task?.instructions, 6000),
    dependencies: normalizeStringList(task?.dependencies, 24, 120),
    acceptanceCriteria: normalizeAcceptanceCriteria(
      task?.acceptanceCriteria ?? task?.criteria
    ),
    requiredCapabilities,
    workspaceScope: normalizeWorkspaceScope(task?.workspaceScope, role),
    resourceLocks: normalizeResourceLocks(task?.resourceLocks),
    priority: integer(task?.priority, 50, 0, 100),
    maxAttempts: integer(task?.maxAttempts, 2, 1, 5)
  };
}

function detectCycle(graph) {
  const visiting = new Set();
  const visited = new Set();

  const visit = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependencyId of graph.get(id)?.dependencies ?? []) {
      if (graph.has(dependencyId) && visit(dependencyId)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  return [...graph.keys()].some(visit);
}


function taskContractProjection(task = {}) {
  return {
    schemaVersion: task.schemaVersion ?? TASK_GRAPH_SCHEMA_VERSION,
    id: text(task.id, 120),
    parentTaskId: text(task.parentTaskId, 120) || null,
    objective: text(task.objective ?? task.title, 2000),
    role: ROLE_SET.has(task.role) ? task.role : "implementer",
    dependencies: normalizeStringList(task.dependencies, 24, 120),
    acceptanceCriteria: normalizeAcceptanceCriteria(task.acceptanceCriteria),
    requiredCapabilities: normalizeStringList(task.requiredCapabilities, 32, 120),
    workspaceScope: normalizeWorkspaceScope(task.workspaceScope, task.role),
    resourceLocks: normalizeResourceLocks(task.resourceLocks),
    priority: integer(task.priority, 50, 0, 100),
    maxAttempts: integer(task.maxAttempts, 2, 1, 5)
  };
}

export function fingerprintTaskGraph(tasks = []) {
  const values = Array.isArray(tasks) ? tasks : Object.values(tasks ?? {});
  return sha256(
    values
      .map((task) => taskContractProjection(task))
      .sort((left, right) => left.id.localeCompare(right.id))
  );
}

export function validateTaskGraph(existingTasks = {}, candidates = [], options = {}) {
  const normalized = [];
  const existingIds = new Set(Object.keys(existingTasks ?? {}));
  const candidateIds = new Set();

  for (const source of Array.isArray(candidates) ? candidates : []) {
    const task = normalizeTaskDefinition(source, options);
    if (!task.id) {
      return { ok: false, code: "task-id-invalid" };
    }
    if (existingIds.has(task.id)) {
      return { ok: false, code: "task-id-exists", taskId: task.id };
    }
    if (candidateIds.has(task.id)) {
      return { ok: false, code: "task-id-duplicate", taskId: task.id };
    }
    candidateIds.add(task.id);
    normalized.push(task);
  }

  if (normalized.length === 0) {
    return { ok: false, code: "task-graph-empty" };
  }

  const knownIds = new Set([...existingIds, ...candidateIds]);
  for (const task of normalized) {
    if (task.dependencies.includes(task.id)) {
      return { ok: false, code: "task-self-dependency", taskId: task.id };
    }
    const missing = task.dependencies.filter((id) => !knownIds.has(id));
    if (missing.length > 0) {
      return {
        ok: false,
        code: "task-dependency-not-found",
        taskId: task.id,
        dependencyIds: missing
      };
    }
    if (task.parentTaskId && !knownIds.has(task.parentTaskId)) {
      return {
        ok: false,
        code: "task-parent-not-found",
        taskId: task.id,
        parentTaskId: task.parentTaskId
      };
    }
  }

  const graph = new Map();
  for (const [id, task] of Object.entries(existingTasks ?? {})) {
    graph.set(id, {
      id,
      dependencies: normalizeStringList(task?.dependencies, 24, 120)
    });
  }
  for (const task of normalized) graph.set(task.id, task);
  if (detectCycle(graph)) {
    return { ok: false, code: "task-graph-cycle" };
  }

  return {
    ok: true,
    tasks: normalized,
    fingerprint: fingerprintTaskGraph(normalized)
  };
}

export function normalizeStoredTask(task = {}) {
  const normalized = normalizeTaskDefinition(task, {
    createId: () => text(task.id, 120),
    defaultRole: text(task.role, 80) || "implementer"
  });
  return {
    ...task,
    ...normalized,
    assignedAgentId: text(task.assignedAgentId, 120) || null,
    checkpoint: task.checkpoint && typeof task.checkpoint === "object"
      ? structuredClone(task.checkpoint)
      : null,
    receipts: normalizeStringList(task.receipts, 100, 120),
    evaluation: task.evaluation && typeof task.evaluation === "object"
      ? structuredClone(task.evaluation)
      : {
          status: "pending",
          attempt: 0,
          approved: false,
          evaluatorAgentRunId: null,
          summary: "",
          findings: [],
          recordedAt: null
        },
    evaluationHistory: Array.isArray(task.evaluationHistory)
      ? task.evaluationHistory.slice(-20).map((item) => structuredClone(item))
      : [],
    integrationStatus: text(task.integrationStatus, 40) || "pending"
  };
}
