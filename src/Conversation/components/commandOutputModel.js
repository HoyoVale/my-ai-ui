export function commandPreview(tool) {
  const source =
    tool?.result?.commandPreview ??
    tool?.commandPreview ??
    tool?.result?.data?.data ??
    tool?.result?.data ??
    tool?.output?.data ??
    null;
  return source && typeof source === "object" && source.displayCommand
    ? source
    : null;
}

export function hasCommandPreview(tool) {
  return Boolean(commandPreview(tool));
}
