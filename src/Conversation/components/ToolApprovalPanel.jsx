import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  ConversationIcon
} from "./Icon.jsx";

const EFFECT_LABELS = Object.freeze({
  local_write: "本地文件写入",
  remote_write: "外部系统写入",
  destructive: "破坏性操作"
});

function stringify(value) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function sourceLabel(source) {
  if (String(source).startsWith("mcp.")) return "MCP";
  if (String(source).startsWith("custom.http.")) return "Custom HTTP";
  return "Built-in";
}

export function ToolApprovalPanel({ approval }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setBusy("");
    setError("");
  }, [approval?.id]);

  const inputText = useMemo(
    () => stringify(approval?.input),
    [approval?.input]
  );

  if (!approval?.id) {
    return null;
  }

  const resolve = async (decision) => {
    if (busy) return;
    setBusy(decision);
    setError("");
    try {
      const result = await window.api?.resolveToolApproval?.({
        approvalId: approval.id,
        decision
      });
      if (!result?.ok) {
        throw new Error(result?.message ?? "无法处理工具批准请求。");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy("");
    }
  };

  return (
    <section
      className="conversation-tool-approval"
      data-testid="tool-approval-panel"
      data-approval-id={approval.id}
      role="alertdialog"
      aria-labelledby="tool-approval-title"
      aria-describedby="tool-approval-reason"
    >
      <header className="conversation-tool-approval__header">
        <span className="conversation-tool-approval__icon">
          <ConversationIcon name="warning" size={18} />
        </span>
        <div>
          <strong id="tool-approval-title">工具需要你的批准</strong>
          <small>
            {approval.queuedCount > 1
              ? `当前还有 ${approval.queuedCount - 1} 个请求排队`
              : "批准前不会执行此操作"}
          </small>
        </div>
      </header>

      <div className="conversation-tool-approval__body">
        <div className="conversation-tool-approval__identity">
          <strong>{approval.title}</strong>
          <span>{sourceLabel(approval.source)}</span>
          <span>{EFFECT_LABELS[approval.effect] ?? approval.effect}</span>
        </div>

        <p id="tool-approval-reason">{approval.reason}</p>

        {approval.untrustedContent && (
          <div className="conversation-tool-approval__warning">
            <strong>不可信内容隔离已启用</strong>
            <span>
              此任务此前读取的 MCP 内容包含疑似提示词注入信号。本次批准只对当前调用有效。
            </span>
          </div>
        )}

        <details className="conversation-tool-approval__details">
          <summary>查看工具参数</summary>
          <pre>{inputText}</pre>
          {approval.inputTruncated && <small>参数预览已截断。</small>}
        </details>

        {error && (
          <p className="conversation-tool-approval__error">{error}</p>
        )}
      </div>

      <footer className="conversation-tool-approval__actions">
        <button
          type="button"
          className="is-secondary"
          data-testid="tool-approval-deny"
          disabled={Boolean(busy)}
          onClick={() => void resolve("deny")}
        >
          {busy === "deny" ? "处理中…" : "拒绝"}
        </button>
        {approval.allowRunGrant && (
          <button
            type="button"
            className="is-secondary"
            data-testid="tool-approval-allow-run"
            disabled={Boolean(busy)}
            onClick={() => void resolve("allow_run")}
          >
            {busy === "allow_run" ? "处理中…" : "本任务内允许"}
          </button>
        )}
        <button
          type="button"
          className="is-primary"
          data-testid="tool-approval-allow-once"
          disabled={Boolean(busy)}
          onClick={() => void resolve("allow_once")}
        >
          {busy === "allow_once" ? "处理中…" : "仅本次允许"}
        </button>
      </footer>
    </section>
  );
}
