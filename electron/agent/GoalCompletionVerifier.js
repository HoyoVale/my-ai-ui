const MUTATION_TOOLS = new Set([
  "write_text_file",
  "replace_text_in_file",
  "append_text_file",
  "create_directory",
  "move_path",
  "delete_path",
  "apply_patch"
]);

const INSPECTION_TOOLS = new Set([
  "read_text_file",
  "read_multiple_files",
  "compare_files",
  "compute_file_hash",
  "git_diff",
  "git_inspect",
  "inspect_path",
  "stat_path"
]);

const VALIDATION_PATTERNS = Object.freeze({
  test: /(?:^|[\s:/_-])(?:test|tests|vitest|jest|pytest|playwright|e2e|node\s+--test)(?:$|[\s:/_-])/iu,
  build: /(?:^|[\s:/_-])(?:build|compile|rollup|vite\s+build|webpack)(?:$|[\s:/_-])/iu,
  lint: /(?:^|[\s:/_-])(?:lint|eslint|oxlint|biome|ruff)(?:$|[\s:/_-])/iu,
  typecheck: /(?:type[\s:_-]?check|tsc(?:\s|$)|mypy|pyright)/iu,
  check: /(?:^|[\s:/_-])check(?:$|[\s:/_-])/iu
});

const MUTATION_INTENT = /(?:修复|修改|实现|添加|新增|删除|重构|创建|生成|开发|优化|替换|写入|更新|接入|安装|配置|fix|implement|add|remove|refactor|create|generate|develop|optimi[sz]e|replace|write|update|integrate|install|configure)/iu;
const GUIDANCE_INTENT = /(?:如何|怎么|怎样|教程|方法|示例|解释|说明|介绍|告诉我|how\s+to|explain|describe|guide|example)/iu;
const ACTION_AFTER_GUIDANCE = /(?:并且|并|然后|同时|之后|再|and\s+then|then|also).{0,80}(?:修复|修改|实现|添加|删除|重构|创建|生成|开发|优化|替换|写入|更新|接入|安装|配置|fix|implement|add|remove|refactor|create|generate|develop|optimi[sz]e|replace|write|update|integrate|install|configure)/iu;

function text(value, maxLength = 600) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function recordOutput(record) {
  return record?.result ?? record?.output ?? {};
}

function completed(record) {
  const output = recordOutput(record);
  return record?.status === "completed" &&
    output?.ok !== false &&
    !output?.error;
}

function commandText(record) {
  if (record?.name !== "run_workspace_command") {
    return "";
  }
  const output = recordOutput(record);
  const command = record?.input?.command ?? output?.data?.command ?? "";
  const args = record?.input?.args ?? output?.data?.args ?? [];
  return text([command, ...(Array.isArray(args) ? args : [])].join(" "), 1200);
}

function validationKinds(command) {
  return Object.entries(VALIDATION_PATTERNS)
    .filter(([, pattern]) => pattern.test(command))
    .map(([kind]) => kind);
}

function expectedValidationCommand(value) {
  const source = String(value ?? "");
  const fencedCandidate = source.match(/`([^`]{2,160})`/u)?.[1] ?? "";
  const fenced = /^(?:npm|pnpm|yarn|bun|pytest|vitest|jest|playwright|tsc|mypy|pyright)\b/iu
    .test(fencedCandidate.trim())
    ? fencedCandidate
    : "";
  const direct = source.match(/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test(?::[\w-]+)?|build|lint|check|typecheck)(?:\s+[-\w:./=]+){0,4}/iu)?.[0];
  const standalone = source.match(/\b(?:pytest|vitest|jest|playwright\s+test|tsc|mypy|pyright)\b(?:\s+[-\w:./=]+){0,4}/iu)?.[0];
  return text(fenced || direct || standalone || "", 180).toLowerCase();
}

function requestedValidationKinds(objective) {
  const source = text(objective, 4000);
  const requested = [];
  if (/(?:测试|test|e2e|端到端)/iu.test(source)) requested.push("test");
  if (/(?:构建|打包|build|compile)/iu.test(source)) requested.push("build");
  if (/(?:lint|代码规范|静态检查)/iu.test(source)) requested.push("lint");
  if (/(?:类型检查|type[\s_-]?check|tsc)/iu.test(source)) requested.push("typecheck");
  return [...new Set(requested)];
}

function requestsAction(objective) {
  const source = text(objective, 2400);
  return !GUIDANCE_INTENT.test(source) || ACTION_AFTER_GUIDANCE.test(source);
}

function planSummary(plan) {
  const items = Array.isArray(plan) ? plan : [];
  return {
    total: items.length,
    unfinished: items.filter((item) =>
      ["pending", "in_progress"].includes(item?.status)
    ).length,
    needsInput: items.filter((item) => item?.status === "needs_input").length,
    blocked: items.filter((item) => item?.status === "blocked").length,
    cancelled: items.filter((item) => item?.status === "cancelled").length
  };
}

function check(id, passed, detail, evidence = [], extra = {}) {
  return {
    id,
    passed: passed === true,
    detail: text(detail, 500),
    evidence: evidence.map((value) => text(value, 240)).filter(Boolean).slice(0, 20),
    ...extra
  };
}

export function inferGoalCriterionKind(criterion) {
  const explicit = String(criterion?.verificationKind ?? "auto");
  if (explicit !== "auto") return explicit;
  const source = text(criterion?.text, 800);
  if (/(?:测试|test|e2e|端到端|vitest|jest|pytest|playwright)/iu.test(source)) return "test";
  if (/(?:构建|打包|build|compile|编译)/iu.test(source)) return "build";
  if (/(?:lint|代码规范|静态检查|eslint|oxlint|biome|ruff)/iu.test(source)) return "lint";
  if (/(?:类型检查|type[\s_-]?check|tsc|mypy|pyright)/iu.test(source)) return "typecheck";
  if (/(?:检查命令|check\s+(?:passes|通过)|npm\s+run\s+check)/iu.test(source)) return "check";
  if (MUTATION_INTENT.test(source)) return "change";
  return "manual";
}

export function createGoalVerificationInstruction(verification) {
  if (!verification || verification.status === "verified") {
    return "";
  }
  const missing = (verification.checks ?? [])
    .filter((item) => item?.passed !== true)
    .map((item) => `- ${text(item.detail, 300)}`);

  return [
    "[Goal completion verifier]",
    "The runtime did not accept the goal as complete. Continue working; do not merely restate that it is done.",
    missing.length > 0 ? `Missing completion evidence:\n${missing.join("\n")}` : "Completion evidence is incomplete.",
    "Use available tools to produce objective evidence, repair failures, and update the root plan honestly. Only stop for genuinely missing user input, an external blocker, or a runtime safety boundary."
  ].join("\n");
}

export class GoalCompletionVerifier {
  verify({
    goal = null,
    objective = "",
    mode = "chat",
    plan = [],
    records = [],
    runtimeRecovery = null,
    availableToolNames = []
  } = {}) {
    const goalObjective = text(goal?.objective || objective, 4000);
    const criteria = (Array.isArray(goal?.criteria) ? goal.criteria : [])
      .filter((item) => item?.id && item?.text)
      .slice(0, 12);
    const tools = Array.isArray(records) ? records : [];
    const available = new Set(
      Array.isArray(availableToolNames) ? availableToolNames : []
    );
    const planState = planSummary(plan);
    const checks = [];

    checks.push(check(
      "plan_settled",
      planState.unfinished === 0,
      planState.unfinished === 0
        ? "总计划没有未完成步骤。"
        : `总计划仍有 ${planState.unfinished} 个 pending 或 in_progress 步骤。`
    ));

    if (planState.needsInput > 0) {
      return this.result("needs_input", checks, {
        reason: "计划明确标记为需要用户输入。"
      });
    }
    if (planState.blocked > 0 && planState.unfinished === 0) {
      return this.result("blocked", checks, {
        reason: "计划已进入无法自动解除的阻塞状态。"
      });
    }
    if (planState.cancelled > 0) {
      checks.push(check(
        "plan_not_cancelled",
        false,
        "总计划包含已取消步骤，不能证明目标完整达成。"
      ));
    }

    const unresolved = Math.max(
      0,
      Number(runtimeRecovery?.unresolvedCount) || 0
    );
    checks.push(check(
      "runtime_effects_settled",
      unresolved === 0,
      unresolved === 0
        ? "所有已记录副作用均已结算。"
        : `仍有 ${unresolved} 个副作用状态需要核验或确认。`
    ));

    const mutationIndexes = [];
    const mutationEvidence = [];
    tools.forEach((record, index) => {
      if (MUTATION_TOOLS.has(record?.name) && completed(record)) {
        mutationIndexes.push(index);
        mutationEvidence.push(record?.id ?? record?.name);
      }
    });
    const actionRequested = requestsAction(goalObjective);
    const mutationRequested = mode === "coding" &&
      actionRequested &&
      MUTATION_INTENT.test(goalObjective);
    const mutationRequired = mutationRequested || mutationIndexes.length > 0;

    if (mutationRequired) {
      checks.push(check(
        "change_evidence",
        mutationIndexes.length > 0,
        mutationIndexes.length > 0
          ? "已找到由 Runtime 确认的文件变更收据。"
          : "目标要求修改实现，但没有成功的工作区写入或补丁证据。",
        mutationEvidence
      ));
    }

    const lastMutationIndex = mutationIndexes.length > 0
      ? mutationIndexes.at(-1)
      : -1;
    const validation = [];
    const inspection = [];
    tools.forEach((record, index) => {
      if (index <= lastMutationIndex || !completed(record)) {
        return;
      }
      const command = commandText(record);
      const kinds = validationKinds(command);
      if (kinds.length > 0) {
        validation.push({
          id: record?.id ?? record?.name,
          kinds,
          command
        });
      }
      if (INSPECTION_TOOLS.has(record?.name)) {
        inspection.push(record?.id ?? record?.name);
      }
    });

    const criteriaText = criteria.map((item) => item.text).join("\n");
    const requestedKinds = requestedValidationKinds(`${goalObjective}\n${criteriaText}`);
    const validatedKinds = new Set(validation.flatMap((item) => item.kinds));
    const missingRequestedKinds = requestedKinds.filter((kind) =>
      !validatedKinds.has(kind)
    );

    if (mutationIndexes.length > 0) {
      const canRunValidation = available.has("run_workspace_command");
      const hasPostChangeEvidence = canRunValidation
        ? validation.length > 0
        : validation.length > 0 || inspection.length > 0;
      checks.push(check(
        "post_change_validation",
        hasPostChangeEvidence,
        hasPostChangeEvidence
          ? canRunValidation
            ? "文件变更后已有成功的测试、构建、Lint 或类型检查。"
            : "当前没有进程验证能力；已使用可用的只读工具复核变更。"
          : canRunValidation
            ? "文件变更后尚无成功的测试、构建、Lint 或类型检查。"
            : "文件变更后尚无可用工具产生的复核证据。",
        [
          ...validation.map((item) => item.id),
          ...inspection
        ]
      ));
    }

    const explicitValidationRequested = mode === "coding" && actionRequested;
    if (
      requestedKinds.length > 0 &&
      (explicitValidationRequested || mutationRequired || tools.length > 0)
    ) {
      checks.push(check(
        "requested_validation",
        missingRequestedKinds.length === 0,
        missingRequestedKinds.length === 0
          ? "用户明确要求的验证类型均已有成功证据。"
          : `缺少用户明确要求的验证证据：${missingRequestedKinds.join(", ")}。`,
        validation.map((item) => item.id)
      ));
    }

    for (const criterion of criteria) {
      const kind = inferGoalCriterionKind(criterion);
      let passed = false;
      let detail = "";
      let evidence = [];

      if (kind === "manual") {
        passed = criterion.manualSatisfied === true;
        detail = passed
          ? `完成标准“${text(criterion.text, 180)}”已由用户确认。`
          : `完成标准“${text(criterion.text, 180)}”无法从工具结果客观判断，需要用户确认。`;
        evidence = passed ? ["user-confirmed"] : [];
      } else if (kind === "change") {
        passed = mutationIndexes.length > 0;
        detail = passed
          ? `完成标准“${text(criterion.text, 180)}”已有变更收据。`
          : `完成标准“${text(criterion.text, 180)}”缺少工作区变更收据。`;
        evidence = mutationEvidence;
      } else {
        const expectedCommand = expectedValidationCommand(criterion.text);
        const matchingValidation = validation.filter((item) =>
          item.kinds.includes(kind) &&
          (!expectedCommand || item.command.toLowerCase().includes(expectedCommand))
        );
        passed = matchingValidation.length > 0;
        detail = passed
          ? `完成标准“${text(criterion.text, 180)}”已有 ${kind} 验证证据。`
          : expectedCommand
            ? `完成标准“${text(criterion.text, 180)}”缺少命令“${expectedCommand}”的成功证据。`
            : `完成标准“${text(criterion.text, 180)}”缺少修改后的 ${kind} 成功证据。`;
        evidence = matchingValidation.map((item) => item.id);
      }

      checks.push(check(
        `criterion:${criterion.id}`,
        passed,
        detail,
        evidence,
        {
          criterionId: criterion.id,
          criterionText: text(criterion.text, 500),
          verificationKind: kind
        }
      ));
    }

    const passed = checks.every((item) => item.passed);
    return this.result(passed ? "verified" : "incomplete", checks, {
      reason: passed
        ? "计划、运行时状态与客观证据均满足完成门。"
        : "至少一项完成条件缺少客观证据。",
      evidence: {
        mutations: mutationEvidence,
        validations: validation.map((item) => ({
          id: text(item.id, 120),
          kinds: item.kinds,
          command: text(item.command, 300)
        })),
        inspections: inspection.map((item) => text(item, 120)),
        criteria: checks
          .filter((item) => item.criterionId)
          .map((item) => ({
            id: item.criterionId,
            passed: item.passed,
            verificationKind: item.verificationKind,
            evidence: item.evidence
          })),
        level: validation.length > 0
          ? "strong"
          : inspection.length > 0
            ? "limited"
            : "none"
      }
    });
  }

  result(status, checks, extra = {}) {
    return {
      version: 2,
      status,
      verified: status === "verified",
      checkedAt: Date.now(),
      checks,
      ...extra
    };
  }
}
