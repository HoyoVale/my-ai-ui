import {
  classifyToolFailureHistory
} from "../ToolErrorClassifier.js";

const OPEN_RECORD_STATUSES = new Set([
  "queued",
  "running",
  "in_progress",
  "retrying",
  "cancelling",
  "interrupted",
  "unknown",
  "needs_reconciliation",
  "needs_confirmation",
  "attention"
]);

const CLAIM_PATTERNS = Object.freeze({
  build_success: [
    /(?:构建|编译).{0,16}(?:成功|通过|完成)/u,
    /(?:build|compile).{0,20}(?:succeeded|successful|passed|completed)/iu
  ],
  tests_passed: [
    /(?:测试|用例).{0,20}(?:全部|均|已经|已)?(?:通过|成功)/u,
    /(?:all\s+)?tests?.{0,24}(?:passed|successful|succeeded)/iu
  ],
  install_success: [
    /(?:依赖|安装).{0,16}(?:成功|完成|已安装)/u,
    /(?:install|dependencies).{0,24}(?:succeeded|successful|completed|installed)/iu
  ],
  task_completed: [
    /(?:任务|项目|计划|所有步骤).{0,20}(?:已经|已|全部|均)?(?:完成|成功结束)/u,
    /(?:task|project|plan|all steps).{0,24}(?:completed|finished|done successfully)/iu
  ]
});

function compact(value, limit = 1200) {
  return String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, limit);
}

function finalTextValue(value) {
  return String(value ?? "").trim();
}

function hasPositiveClaimMatch(text, patterns) {
  return patterns.some((pattern) => {
    const match = pattern.exec(text);
    if (!match) return false;
    const start = Math.max(0, match.index - 18);
    const context = text.slice(start, match.index + match[0].length);
    return !/(?:尚未|未能|没有|并未|无法|不能|不代表|not\s+yet|not\s+completed|failed\s+to|could\s+not)/iu.test(context);
  });
}

function nested(source, paths) {
  for (const path of paths) {
    let current = source;
    let found = true;
    for (const key of path) {
      if (!current || typeof current !== "object" || !(key in current)) {
        found = false;
        break;
      }
      current = current[key];
    }
    if (found && current !== undefined && current !== null) return current;
  }
  return undefined;
}

function commandText(record) {
  return compact(nested(record, [
    ["commandPreview", "displayCommand"],
    ["result", "commandPreview", "displayCommand"],
    ["result", "data", "displayCommand"],
    ["output", "data", "displayCommand"]
  ]) || [
    record?.name,
    record?.input?.script,
    record?.input?.task,
    record?.input?.command
  ].filter(Boolean).join(" "), 600);
}

function exitCode(record) {
  const value = nested(record, [
    ["commandPreview", "exitCode"],
    ["result", "commandPreview", "exitCode"],
    ["result", "data", "exitCode"],
    ["result", "exitCode"],
    ["output", "data", "exitCode"]
  ]);
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function recordSucceeded(record) {
  if (String(record?.status ?? "") !== "completed") return false;
  if (record?.result?.ok === false || record?.output?.ok === false) return false;
  if (record?.result?.error || record?.output?.error) return false;
  const code = exitCode(record);
  return code === null || code === 0;
}

function commandKind(record) {
  const value = commandText(record).toLowerCase();
  const script = compact(record?.input?.script ?? record?.input?.task, 80).toLowerCase();
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:install|i)\b|\binstall\b/iu.test(value)) return "install";
  if (/\b(?:test|vitest|jest|playwright|pytest|ctest)\b/iu.test(`${value} ${script}`)) return "test";
  if (/\b(?:build|compile|tsc|vite\s+build)\b/iu.test(`${value} ${script}`)) return "build";
  return "other";
}

function latestCommandEvidence(records, kind) {
  const candidates = (Array.isArray(records) ? records : [])
    .filter((record) => commandKind(record) === kind);
  const latest = candidates.at(-1) ?? null;
  return {
    found: Boolean(latest),
    success: Boolean(latest && recordSucceeded(latest)),
    command: latest ? commandText(latest) : "",
    exitCode: latest ? exitCode(latest) : null,
    recordId: compact(latest?.id, 160),
    error: compact(
      latest?.result?.error?.message ??
      latest?.output?.error?.message ??
      latest?.lastError?.message,
      600
    )
  };
}

function changedFiles(diffSummary) {
  if (!diffSummary || typeof diffSummary !== "object") return [];
  const files = Array.isArray(diffSummary.files) ? diffSummary.files : [];
  return files
    .map((file) => compact(file?.path ?? file?.filePath, 300))
    .filter(Boolean)
    .slice(0, 20);
}

export function buildCompletionEvidence({
  records = [],
  diffSummary = null
} = {}) {
  const normalizedRecords = Array.isArray(records) ? records : [];
  const failures = classifyToolFailureHistory(normalizedRecords);
  const openRecords = normalizedRecords.filter((record) =>
    OPEN_RECORD_STATUSES.has(String(record?.status ?? ""))
  );
  const build = latestCommandEvidence(normalizedRecords, "build");
  const tests = latestCommandEvidence(normalizedRecords, "test");
  const install = latestCommandEvidence(normalizedRecords, "install");

  return {
    canComplete: Boolean(
      !failures.hasActive &&
      openRecords.length === 0
    ),
    failures,
    openRecordIds: openRecords
      .map((record) => compact(record?.id, 160))
      .filter(Boolean),
    commands: {
      build,
      tests,
      install
    },
    changedFiles: changedFiles(diffSummary)
  };
}

export function extractCompletionClaims(finalText = "") {
  const text = compact(finalText, 12000);
  if (!text) return [];

  const claims = [];
  for (const [type, patterns] of Object.entries(CLAIM_PATTERNS)) {
    if (hasPositiveClaimMatch(text, patterns)) {
      claims.push(type);
    }
  }
  return claims;
}

export function validateCompletionClaims({
  finalText = "",
  evidence,
  outcome = ""
} = {}) {
  const resolvedEvidence = evidence ?? buildCompletionEvidence();
  const claims = extractCompletionClaims(finalText);
  const unsupported = [];

  for (const claim of claims) {
    if (claim === "build_success" && !resolvedEvidence.commands.build.success) {
      unsupported.push(claim);
    } else if (claim === "tests_passed" && !resolvedEvidence.commands.tests.success) {
      unsupported.push(claim);
    } else if (claim === "install_success" && !resolvedEvidence.commands.install.success) {
      unsupported.push(claim);
    } else if (
      claim === "task_completed" &&
      (outcome !== "completed" || !resolvedEvidence.canComplete)
    ) {
      unsupported.push(claim);
    }
  }

  return {
    valid: unsupported.length === 0,
    claims,
    unsupported
  };
}

function failureSummary(evidence, lastError = "") {
  const latest = evidence.failures.latestActive;
  const message = compact(
    latest?.message ||
    evidence.commands.build.error ||
    evidence.commands.tests.error ||
    evidence.commands.install.error ||
    lastError,
    700
  );
  const command = compact(
    evidence.commands.build.success === false && evidence.commands.build.found
      ? evidence.commands.build.command
      : evidence.commands.tests.success === false && evidence.commands.tests.found
        ? evidence.commands.tests.command
        : evidence.commands.install.success === false && evidence.commands.install.found
          ? evidence.commands.install.command
          : "",
    500
  );
  return { message, command };
}

export function createEvidenceBackedSummary({
  evidence,
  outcome = "",
  stopReason = "",
  lastError = ""
} = {}) {
  const resolved = evidence ?? buildCompletionEvidence();
  const lines = [];

  if (outcome === "completed" && resolved.canComplete) {
    lines.push("本次任务已完成。");
  } else if (["continuable", "interrupted", "needs_input", "blocked"].includes(outcome)) {
    lines.push("本次工作已保存，但任务尚未全部完成。");
  } else if (outcome === "cancelled") {
    lines.push("本次任务已取消。");
  } else {
    lines.push("本次执行未能完成。");
  }

  const failure = failureSummary(resolved, lastError);
  if (failure.command || failure.message) {
    lines.push("", "当前问题");
    if (failure.command) lines.push(`- 命令：${failure.command}`);
    if (failure.message) lines.push(`- ${failure.message}`);
  }

  if (resolved.changedFiles.length > 0) {
    lines.push("", "已产生的文件改动");
    lines.push(...resolved.changedFiles.map((item) => `- ${item}`));
  }

  if (!failure.message && stopReason && outcome !== "completed") {
    lines.push("", `状态：${compact(stopReason, 160)}`);
  }

  return lines.join("\n").trim();
}

export function reconcileFinalResponse({
  finalText = "",
  records = [],
  diffSummary = null,
  outcome = "",
  stopReason = "",
  lastError = ""
} = {}) {
  const evidence = buildCompletionEvidence({
    records,
    diffSummary
  });
  const validation = validateCompletionClaims({
    finalText,
    evidence,
    outcome
  });

  if (validation.valid) {
    return {
      text: finalTextValue(finalText),
      changed: false,
      evidence,
      validation
    };
  }

  return {
    text: createEvidenceBackedSummary({
      evidence,
      outcome,
      stopReason,
      lastError
    }),
    changed: true,
    evidence,
    validation
  };
}
