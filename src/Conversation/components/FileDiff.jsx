function cleanDiffPath(value = "") {
  return String(value)
    .replace(/^(?:a|b)\//u, "")
    .replace(/\t.*$/u, "")
    .trim();
}

function parseHunkHeader(line) {
  const match = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/u.exec(line);
  if (!match) return null;
  return {
    oldStart: Number(match[1]),
    oldCount: Number(match[2] ?? 1),
    newStart: Number(match[3]),
    newCount: Number(match[4] ?? 1),
    label: String(match[5] ?? "").trim()
  };
}

function parseUnifiedDiff(diff = "", fallbackPaths = []) {
  const lines = String(diff).replace(/\r\n|\r/gu, "\n").split("\n");
  const files = [];
  let current = null;
  let oldLine = null;
  let newLine = null;

  const ensureFile = () => {
    if (current) return current;
    current = {
      oldPath: fallbackPaths[0] ?? "",
      newPath: fallbackPaths[0] ?? "",
      path: fallbackPaths[0] ?? "文件改动",
      rows: [],
      added: 0,
      removed: 0
    };
    files.push(current);
    return current;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("--- ")) {
      const next = lines[index + 1] ?? "";
      current = {
        oldPath: cleanDiffPath(line.slice(4)),
        newPath: next.startsWith("+++ ") ? cleanDiffPath(next.slice(4)) : "",
        path: "",
        rows: [],
        added: 0,
        removed: 0
      };
      current.path = current.newPath && current.newPath !== "/dev/null"
        ? current.newPath
        : current.oldPath || fallbackPaths[files.length] || "文件改动";
      files.push(current);
      oldLine = null;
      newLine = null;
      if (next.startsWith("+++ ")) index += 1;
      continue;
    }

    const file = ensureFile();
    const hunk = parseHunkHeader(line);
    if (hunk) {
      oldLine = hunk.oldStart;
      newLine = hunk.newStart;
      file.rows.push({
        kind: "hunk",
        oldNumber: null,
        newNumber: null,
        content: line,
        label: hunk.label
      });
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      file.rows.push({
        kind: "add",
        oldNumber: null,
        newNumber: newLine,
        content: line.slice(1)
      });
      file.added += 1;
      if (newLine !== null) newLine += 1;
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      file.rows.push({
        kind: "remove",
        oldNumber: oldLine,
        newNumber: null,
        content: line.slice(1)
      });
      file.removed += 1;
      if (oldLine !== null) oldLine += 1;
      continue;
    }
    if (line.startsWith(" ")) {
      file.rows.push({
        kind: "context",
        oldNumber: oldLine,
        newNumber: newLine,
        content: line.slice(1)
      });
      if (oldLine !== null) oldLine += 1;
      if (newLine !== null) newLine += 1;
      continue;
    }
    if (line.startsWith("\\ No newline")) {
      file.rows.push({
        kind: "note",
        oldNumber: null,
        newNumber: null,
        content: line
      });
      continue;
    }
    if (line || file.rows.length === 0) {
      file.rows.push({
        kind: "meta",
        oldNumber: null,
        newNumber: null,
        content: line || " "
      });
    }
  }

  return files.filter((file) => file.rows.length > 0 || file.added > 0 || file.removed > 0);
}

function diffStats(files) {
  return files.reduce((summary, file) => ({
    added: summary.added + file.added,
    removed: summary.removed + file.removed
  }), { added: 0, removed: 0 });
}

function LineNumber({ value }) {
  return (
    <span className="conversation-file-diff__number" aria-hidden="true">
      {value ?? ""}
    </span>
  );
}

function DiffRow({ row, index }) {
  const prefix = row.kind === "add" ? "+" : row.kind === "remove" ? "−" : " ";
  return (
    <div
      className={`conversation-file-diff__row is-${row.kind}`}
      data-line-kind={row.kind}
      key={`${index}:${row.kind}:${row.oldNumber}:${row.newNumber}`}
    >
      <LineNumber value={row.oldNumber} />
      <LineNumber value={row.newNumber} />
      <span className="conversation-file-diff__marker" aria-hidden="true">
        {row.kind === "hunk" || row.kind === "meta" || row.kind === "note" ? "" : prefix}
      </span>
      <code>{row.content || " "}</code>
    </div>
  );
}

function DiffFile({ file, index }) {
  return (
    <section className="conversation-file-diff__file" data-testid="conversation-file-diff-file">
      <header>
        <span className="conversation-file-diff__file-index">{index + 1}</span>
        <strong title={file.path}>{file.path}</strong>
        <span className="conversation-file-diff__stats" aria-label={`新增 ${file.added} 行，删除 ${file.removed} 行`}>
          <b className="is-add">+{file.added}</b>
          <b className="is-remove">−{file.removed}</b>
        </span>
      </header>
      <div className="conversation-file-diff__code" role="table" aria-label={`${file.path} 文件差异`}>
        {file.rows.map((row, rowIndex) => (
          <DiffRow key={`${index}:${rowIndex}`} row={row} index={rowIndex} />
        ))}
      </div>
    </section>
  );
}

export function FileDiffPreview({ change, defaultOpen = false, compact = false }) {
  if (!change?.diff) return null;
  const paths = Array.isArray(change.paths) ? change.paths : [];
  const files = parseUnifiedDiff(change.diff, paths);
  const stats = diffStats(files);
  const title = files.length === 1
    ? files[0].path
    : `${files.length || paths.length || 1} 个文件`;

  return (
    <details
      className={`conversation-file-diff${compact ? " is-compact" : ""}`}
      open={defaultOpen || undefined}
      data-testid="conversation-file-diff"
    >
      <summary>
        <span className="conversation-file-diff__chevron" aria-hidden="true">›</span>
        <strong title={title}>{title}</strong>
        <span className="conversation-file-diff__summary-stats">
          <b className="is-add">+{stats.added}</b>
          <b className="is-remove">−{stats.removed}</b>
        </span>
      </summary>
      <div className="conversation-file-diff__body">
        {files.map((file, index) => (
          <DiffFile key={`${file.path}:${index}`} file={file} index={index} />
        ))}
      </div>
      {change.truncated && <small>Diff 预览已截断，完整结果仍保存在工具 Receipt 中。</small>}
    </details>
  );
}

export function FileChangesSummary({ changes }) {
  if (!changes?.length) return null;
  const uniquePaths = new Set(changes.flatMap((change) => change.paths ?? []).filter(Boolean));
  const operationLabel = `${changes.length} 次改动`;
  const fileLabel = `${uniquePaths.size || changes.length} 个文件`;

  return (
    <section className="conversation-file-changes" data-testid="conversation-file-changes">
      <header>
        <div>
          <strong>文件改动</strong>
          <span>{operationLabel} · {fileLabel}</span>
        </div>
      </header>
      <div>
        {changes.map((change) => (
          <FileDiffPreview key={change.id} change={change} compact />
        ))}
      </div>
    </section>
  );
}
