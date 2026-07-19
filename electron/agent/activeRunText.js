function textValue(value) {
  return String(value ?? "");
}

export function resolveActiveRunText(
  run,
  {
    trim = false
  } = {}
) {
  const finalText = textValue(run?.finalText);
  const liveText = textValue(run?.currentStepText);
  const selected = finalText.trim()
    ? finalText
    : liveText;

  return trim
    ? selected.trim()
    : selected;
}
