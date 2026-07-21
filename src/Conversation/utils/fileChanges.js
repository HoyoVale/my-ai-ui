function normalizePreview(source) {
  const preview = source?.result?.changePreview ?? source?.changePreview;
  if (!preview?.diff) return null;
  const paths = Array.isArray(preview.paths) && preview.paths.length
    ? preview.paths
    : preview.path ? [preview.path] : [];
  return {
    id: source?.id ?? `${paths.join(":")}:${preview.diff.length}`,
    toolName: source?.name ?? "",
    paths,
    diff: String(preview.diff),
    truncated: preview.truncated === true
  };
}

export function collectFileChanges(snapshot) {
  const changes = [];
  const seen = new Set();
  for (const event of snapshot?.events ?? []) {
    if (event?.type !== "tool") continue;
    const normalized = normalizePreview(event.tool);
    if (!normalized) continue;
    const key = `${normalized.id}:${normalized.diff}`;
    if (seen.has(key)) continue;
    seen.add(key);
    changes.push(normalized);
  }
  return changes;
}
