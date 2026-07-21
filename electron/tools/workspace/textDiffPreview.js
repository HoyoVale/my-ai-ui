const DEFAULT_CONTEXT = 3;
const DEFAULT_MAX_CHARS = 24000;

function normalizedLines(value) {
  return String(value ?? "")
    .replace(/\r\n|\r/gu, "\n")
    .split("\n");
}

function bounded(text, maxChars) {
  const value = String(text ?? "");
  if (value.length <= maxChars) {
    return { text: value, truncated: false };
  }
  return {
    text: `${value.slice(0, Math.max(0, maxChars - 40))}\n… diff preview truncated …`,
    truncated: true
  };
}

export function createTextDiffPreview({
  path = "file",
  before = "",
  after = "",
  contextLines = DEFAULT_CONTEXT,
  maxChars = DEFAULT_MAX_CHARS
} = {}) {
  const left = normalizedLines(before);
  const right = normalizedLines(after);
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const context = Math.max(0, Math.min(12, Number(contextLines) || DEFAULT_CONTEXT));
  const leftStart = Math.max(0, prefix - context);
  const rightStart = Math.max(0, prefix - context);
  const leftEnd = Math.min(left.length, left.length - suffix + context);
  const rightEnd = Math.min(right.length, right.length - suffix + context);
  const oldCount = Math.max(0, leftEnd - leftStart);
  const newCount = Math.max(0, rightEnd - rightStart);
  const lines = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${leftStart + 1},${oldCount} +${rightStart + 1},${newCount} @@`
  ];

  for (let index = leftStart; index < prefix; index += 1) {
    lines.push(` ${left[index]}`);
  }
  for (let index = prefix; index < left.length - suffix; index += 1) {
    lines.push(`-${left[index]}`);
  }
  for (let index = prefix; index < right.length - suffix; index += 1) {
    lines.push(`+${right[index]}`);
  }
  for (let index = Math.max(prefix, right.length - suffix); index < rightEnd; index += 1) {
    lines.push(` ${right[index]}`);
  }

  const result = bounded(lines.join("\n"), maxChars);
  return {
    kind: "unified_diff",
    path: String(path),
    diff: result.text,
    truncated: result.truncated
  };
}

export function createPatchDiffPreview({ patch = "", paths = [], maxChars = DEFAULT_MAX_CHARS } = {}) {
  const result = bounded(String(patch), maxChars);
  return {
    kind: "unified_diff",
    path: paths.length === 1 ? String(paths[0]) : "",
    paths: paths.map(String).slice(0, 50),
    diff: result.text,
    truncated: result.truncated
  };
}
