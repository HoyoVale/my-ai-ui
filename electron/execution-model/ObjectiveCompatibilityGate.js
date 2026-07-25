import {
  classifyTaskBoundary,
  TASK_BOUNDARIES
} from "./TaskBoundaryClassifier.js";

const EXPLICIT_DRIFT_PATTERNS = [
  /(?:与|和)(?:之前|原来|当前|上述|这个).*?(?:无关|不是同一(?:个)?任务|不同任务|不同项目)/u,
  /(?:这是|属于|改成|切换到).*?(?:新的|另一个|另外一个|不同的)(?:项目|任务|工程)/u,
  /(?:需要|应当|必须)(?:完全)?(?:新建|创建|另建)(?:一个)?(?:项目|任务|工程)/u,
  /(?:不再|不要)(?:继续|沿用)(?:原|之前|当前).*?(?:目标|项目|任务|计划)/u,
  /(?:unrelated|different|separate)\s+(?:task|project|objective)/iu,
  /(?:create|start|build)\s+(?:a\s+)?new\s+(?:project|task|application)/iu
];

function compact(value, limit = 8000) {
  return String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, limit);
}

function planText(planState) {
  const rootItems = Array.isArray(planState)
    ? planState
    : Array.isArray(planState?.rootItems)
      ? planState.rootItems
      : [];

  return rootItems
    .slice(0, 40)
    .map((item) => compact(item?.title, 240))
    .filter(Boolean)
    .join("\n");
}

export function evaluateObjectiveCompatibility({
  currentObjective = "",
  candidateObjective = "",
  message = "",
  reason = "",
  failedAssumption = "",
  planState = null
} = {}) {
  const sourceObjective = compact(currentObjective, 4000);
  const candidate = [
    compact(candidateObjective, 4000),
    compact(message, 4000),
    compact(reason, 1000),
    compact(failedAssumption, 1000),
    planText(planState)
  ].filter(Boolean).join("\n");

  const explicitDrift = EXPLICIT_DRIFT_PATTERNS.some((pattern) =>
    pattern.test(candidate)
  );
  const boundary = classifyTaskBoundary({
    message: candidate,
    currentObjective: sourceObjective
  });
  const incompatible = Boolean(
    sourceObjective &&
    candidate &&
    (
      explicitDrift ||
      boundary.boundary === TASK_BOUNDARIES.NEW_TASK
    )
  );

  return {
    compatible: !incompatible,
    relation: incompatible ? "different_objective" : "compatible_or_uncertain",
    requiresNewThread: incompatible,
    confidence: explicitDrift
      ? 1
      : boundary.confidence,
    reasons: [
      ...(explicitDrift ? ["explicit-objective-drift"] : []),
      ...boundary.reasons
    ].slice(0, 8),
    currentIdentifiers: boundary.currentIdentifiers,
    candidateIdentifiers: boundary.messageIdentifiers
  };
}
