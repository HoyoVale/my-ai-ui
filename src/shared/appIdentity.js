const FALLBACK_ASSISTANT_NAME = "桌面助手";

export function resolveAssistantDisplayName(
  settings,
  fallback = FALLBACK_ASSISTANT_NAME
) {
  const configured = String(
    settings?.personality?.name ?? ""
  ).trim();

  if (configured) {
    return configured.slice(0, 64);
  }

  const normalizedFallback = String(
    fallback ?? ""
  ).trim();

  return normalizedFallback
    ? normalizedFallback.slice(0, 64)
    : FALLBACK_ASSISTANT_NAME;
}

export { FALLBACK_ASSISTANT_NAME };
