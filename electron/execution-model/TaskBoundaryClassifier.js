export const TASK_BOUNDARIES = Object.freeze({
  SAME_TASK: "same_task",
  NEW_TASK: "new_task",
  UNCERTAIN: "uncertain"
});

const EXPLICIT_NEW_TASK_PATTERNS = [
  /^(?:请(?:你)?|麻烦(?:你)?|现在)?\s*(?:新建|创建|建立|另建|再建)(?:一个|一份|一套)?\s*(?:全新|新的|独立)?\s*(?:项目|任务|工程|应用|程序|仓库)(?:吧|：|:|，|,|。|\s|$)/u,
  /^(?:请(?:你)?|现在)?\s*(?:从零开始|重新开始)(?:做|创建|建立|开发)?(?:一个|一份|一套)?\s*(?:项目|任务|工程|应用|程序|仓库)?(?:吧|：|:|，|,|。|\s|$)/u,
  /^(?:请(?:你)?|现在)?\s*(?:换|切换到|改做)(?:一个|另一个|另外一个|新的)?\s*(?:项目|任务|问题|方向|主题)(?:吧|：|:|，|,|。|\s|$)/u,
  /^(?:另一个|另外一个|新的|全新的|独立的)(?:项目|任务|工程|应用|程序|仓库)(?:是|叫|做|：|:|，|,|。|\s|$)/u,
  /^(?:不要|不再|先别|无需)(?:继续|接着)(?:刚才|之前|上一个|当前)?(?:的)?(?:项目|任务|问题)?(?:吧|，|,|。|\s|$)/u,
  /^(?:new|create|start|build)\s+(?:a\s+)?(?:new|separate|independent)?\s*(?:project|task|app|application|repository)\b/iu,
  /^(?:switch|move)\s+to\s+(?:a\s+)?(?:new|different)\s+(?:project|task|topic)\b/iu,
  /^(?:do not|don't|stop)\s+(?:continue|resume)(?:\s+the)?\s+(?:previous|current)?\s*(?:task|project)?\b/iu
];

const SAME_TASK_PATTERNS = [
  /^(?:请(?:你)?|你)?(?:继续|接着|继续做|接着做|继续执行|继续完成|完成剩余|执行下一步)(?:吧|下去|，|,|。|\s|$)/u,
  /^(?:还是|仍然|依然|又|不过|但是|不对|没有解决|没解决|失败了|报错了|这是日志|这是截图|测试结果)/u,
  /^(?:continue|resume|go on|proceed|still|again|the error|here is the log)\b/iu
];

function compact(value, limit = 4000) {
  return String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, limit);
}

function matches(patterns, value) {
  return patterns.some((pattern) => pattern.test(value));
}

function projectIdentifiers(value) {
  const normalized = compact(value, 2000).toLowerCase();
  const identifiers = new Set();

  for (const match of normalized.matchAll(/[a-z0-9]+(?:[-_.][a-z0-9]+)+/giu)) {
    const token = match[0].replace(/[._]+/gu, "-");
    if (token.length >= 4) identifiers.add(token);
  }

  for (const match of normalized.matchAll(/([\p{Script=Han}a-z0-9_-]{2,32})(?:项目|工程|应用|仓库)/giu)) {
    const token = match[1].trim();
    if (token.length >= 2) identifiers.add(token);
  }

  return [...identifiers].slice(0, 12);
}

export function hasExplicitNewTaskIntent(message) {
  const normalized = compact(message);
  return Boolean(
    normalized &&
    matches(EXPLICIT_NEW_TASK_PATTERNS, normalized)
  );
}

export function classifyTaskBoundary({
  message = "",
  currentObjective = ""
} = {}) {
  const normalizedMessage = compact(message);
  const normalizedObjective = compact(currentObjective);

  if (!normalizedMessage) {
    return {
      boundary: TASK_BOUNDARIES.UNCERTAIN,
      confidence: 0,
      reasons: ["message-empty"],
      currentIdentifiers: projectIdentifiers(normalizedObjective),
      messageIdentifiers: []
    };
  }

  const currentIdentifiers = projectIdentifiers(normalizedObjective);
  const messageIdentifiers = projectIdentifiers(normalizedMessage);

  if (hasExplicitNewTaskIntent(normalizedMessage)) {
    return {
      boundary: TASK_BOUNDARIES.NEW_TASK,
      confidence: 1,
      reasons: ["explicit-new-task"],
      currentIdentifiers,
      messageIdentifiers
    };
  }

  if (matches(SAME_TASK_PATTERNS, normalizedMessage)) {
    return {
      boundary: TASK_BOUNDARIES.SAME_TASK,
      confidence: 0.94,
      reasons: ["explicit-continuation-or-feedback"],
      currentIdentifiers,
      messageIdentifiers
    };
  }

  if (
    currentIdentifiers.length > 0 &&
    messageIdentifiers.length > 0 &&
    !messageIdentifiers.some((item) => currentIdentifiers.includes(item)) &&
    /(?:项目|工程|应用|仓库|project|app|repository)/iu.test(normalizedMessage)
  ) {
    return {
      boundary: TASK_BOUNDARIES.NEW_TASK,
      confidence: 0.9,
      reasons: ["project-identity-changed"],
      currentIdentifiers,
      messageIdentifiers
    };
  }

  return {
    boundary: TASK_BOUNDARIES.UNCERTAIN,
    confidence: 0.35,
    reasons: ["no-hard-boundary-signal"],
    currentIdentifiers,
    messageIdentifiers
  };
}
