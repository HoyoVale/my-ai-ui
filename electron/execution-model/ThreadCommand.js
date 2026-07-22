import {
  THREAD_COMMANDS
} from "./ThreadRoutingDecision.js";

const COMMANDS = new Set(Object.values(THREAD_COMMANDS));

const START_PATTERNS = [
  /^(?:\/|＠|@)?(?:new|start)(?:\s+task)?\b/iu,
  /^(?:新任务|开始新任务|新建任务|换一个问题|另外一个任务|另一个任务)(?:[:：，,。\s]|$)/u
];

const RESUME_PATTERNS = [
  /^(?:\/|＠|@)?(?:continue|resume|proceed)\b/iu,
  /^(?:请)?(?:继续|接着|延续)(?:完成|处理|执行|修改|检查|做)?(?:吧|，|,|。|\s|$)/u,
  /^(?:按|按照)(?:你|刚才|之前|上面)?(?:的)?(?:建议|计划|方案)(?:继续|处理|执行|做)?/u
];

const FORK_PATTERNS = [
  /^(?:\/|＠|@)?fork\b/iu,
  /^(?:从这里|从当前|基于当前)(?:分支|复制一个任务|另开一条线)/u,
  /^(?:保留当前|保留现在)(?:版本|方案)?(?:，|,)?(?:再|并且)?(?:尝试|做)(?:另一|另外)种/u
];

const REGENERATE_PATTERNS = [
  /^(?:\/|＠|@)?regenerate\b/iu,
  /^(?:重新生成|重写这次回复|再生成一次)(?:吧|，|,|。|\s|$)/u
];

const FEEDBACK_PATTERNS = [
  /^(?:还是|仍然|依然|又|但|不过|不对|没有解决|没解决|失败了|报错了|测试结果|这是日志|这是截图)/u,
  /\b(?:still|again|failed|failure|error|log|test result|not fixed|doesn't work|does not work)\b/iu
];

function normalizedText(value, maxLength = 4000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function matchesAny(patterns, value) {
  return patterns.some((pattern) => pattern.test(value));
}

export function normalizeThreadCommand(value) {
  const normalized = normalizedText(value, 40).toLowerCase();
  return COMMANDS.has(normalized) ? normalized : "";
}

export function classifyThreadCommand({
  message = "",
  requestedCommand = "",
  operation = "message",
  activeRun = false,
  explicitContinue = false
} = {}) {
  const explicit = normalizeThreadCommand(requestedCommand);
  if (explicit) {
    return {
      command: explicit,
      source: "explicit",
      evidence: [`explicit-command:${explicit}`]
    };
  }

  if (operation === THREAD_COMMANDS.REGENERATE) {
    return {
      command: THREAD_COMMANDS.REGENERATE,
      source: "operation",
      evidence: ["operation:regenerate"]
    };
  }

  if (operation === THREAD_COMMANDS.FORK) {
    return {
      command: THREAD_COMMANDS.FORK,
      source: "operation",
      evidence: ["operation:fork"]
    };
  }

  if (activeRun) {
    return {
      command: THREAD_COMMANDS.STEER,
      source: "active_run",
      evidence: ["active-run"]
    };
  }

  if (explicitContinue) {
    return {
      command: THREAD_COMMANDS.RESUME,
      source: "explicit_continue",
      evidence: ["explicit-continue-flag"]
    };
  }

  const normalized = normalizedText(message);
  if (!normalized) {
    return { command: "", source: "none", evidence: [] };
  }

  if (matchesAny(FORK_PATTERNS, normalized)) {
    return {
      command: THREAD_COMMANDS.FORK,
      source: "message",
      evidence: ["message-intent:fork"]
    };
  }

  if (matchesAny(REGENERATE_PATTERNS, normalized)) {
    return {
      command: THREAD_COMMANDS.REGENERATE,
      source: "message",
      evidence: ["message-intent:regenerate"]
    };
  }

  if (matchesAny(START_PATTERNS, normalized)) {
    return {
      command: THREAD_COMMANDS.START,
      source: "message",
      evidence: ["message-intent:start"]
    };
  }

  if (matchesAny(RESUME_PATTERNS, normalized)) {
    return {
      command: THREAD_COMMANDS.RESUME,
      source: "message",
      evidence: ["message-intent:resume"]
    };
  }

  if (matchesAny(FEEDBACK_PATTERNS, normalized)) {
    return {
      command: THREAD_COMMANDS.RESUME,
      source: "semantic_feedback",
      evidence: ["message-intent:feedback"]
    };
  }

  return { command: "", source: "none", evidence: [] };
}
