function DiffLine({ line }) {
  const kind = line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")
    ? "meta"
    : line.startsWith("+")
      ? "add"
      : line.startsWith("-")
        ? "remove"
        : "context";
  return <span className={`conversation-file-diff__line is-${kind}`}>{line || " "}</span>;
}

export function FileDiffPreview({ change, defaultOpen = false, compact = false }) {
  if (!change?.diff) return null;
  const paths = change.paths ?? [];
  return (
    <details
      className={`conversation-file-diff${compact ? " is-compact" : ""}`}
      open={defaultOpen || undefined}
      data-testid="conversation-file-diff"
    >
      <summary>
        <span>文件改动</span>
        <strong>{paths.length > 1 ? `${paths.length} 个文件` : paths[0] || "查看 Diff"}</strong>
      </summary>
      <pre>
        {change.diff.split("\n").map((line, index) => (
          <DiffLine key={`${index}:${line}`} line={line} />
        ))}
      </pre>
      {change.truncated && <small>Diff 预览已截断，完整结果仍保存在工具 Receipt 中。</small>}
    </details>
  );
}

export function FileChangesSummary({ changes }) {
  if (!changes?.length) return null;
  return (
    <section className="conversation-file-changes" data-testid="conversation-file-changes">
      <header>
        <strong>文件改动</strong>
        <span>{changes.reduce((sum, item) => sum + Math.max(1, item.paths.length), 0)} 个文件</span>
      </header>
      <div>
        {changes.map((change) => (
          <FileDiffPreview key={change.id} change={change} compact />
        ))}
      </div>
    </section>
  );
}
