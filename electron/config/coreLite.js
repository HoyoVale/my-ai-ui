export const CORE_LITE_MODE = true;

export const CORE_LITE_DISABLED_TOOL_NAMES = Object.freeze([
  "update_plan",
  "replan_goal",
  "update_step_work"
]);

const DISABLED_TOOL_SET = new Set(
  CORE_LITE_DISABLED_TOOL_NAMES
);

export function isCoreLiteDisabledTool(name) {
  return CORE_LITE_MODE &&
    DISABLED_TOOL_SET.has(String(name ?? ""));
}
