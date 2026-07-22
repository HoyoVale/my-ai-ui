import {
  ConversationIcon
} from "./Icon.jsx";

import {
  commandPreview
} from "./commandOutputModel.js";

function outputText(command) {
  const stdout = String(command?.stdout ?? "").trimEnd();
  const stderr = String(command?.stderr ?? "").trimEnd();
  return [stdout, stderr].filter(Boolean).join(stdout && stderr ? "\n" : "");
}

function commandState(command) {
  const running = command.exitCode === undefined || command.exitCode === null;
  const succeeded = !running && Number(command.exitCode) === 0 && command.terminated !== true;
  const failed = !running && !succeeded;

  return {
    running,
    succeeded,
    failed,
    status: running
      ? "running"
      : succeeded
        ? "success"
        : "error",
    label: running
      ? "运行中"
      : succeeded
        ? "已完成"
        : command.terminated
          ? "已终止"
          : `退出码 ${command.exitCode}`
  };
}

export function ToolCommandPreview({
  tool,
  compact = false,
  defaultOpen = false,
  title = "命令",
  resultSummary = "",
  showMetadata = false
}) {
  const command = commandPreview(tool);
  if (!command) return null;

  const output = outputText(command);
  const state = commandState(command);
  const shouldOpen = defaultOpen || state.running || state.failed;

  return (
    <details
      className={`conversation-command-output is-${state.status}${compact ? " is-compact" : ""}`}
      open={shouldOpen || undefined}
      data-testid="conversation-command-output"
      data-tool-kind="command"
    >
      <summary>
        <span className="conversation-command-output__icon">
          <ConversationIcon name="terminal" size={16} />
        </span>
        <span className="conversation-command-output__summary">
          <strong>{title}</strong>
          <code>$ {command.displayCommand}</code>
        </span>
        <span className="conversation-command-output__meta">
          <span className={`conversation-command-output__status is-${state.status}`} />
          <small>{state.label}</small>
        </span>
        <ConversationIcon name="chevron" size={13} />
      </summary>

      <div className="conversation-command-output__body">
        {resultSummary && (
          <p className={`conversation-tool-reply${state.failed ? " is-error" : ""}`}>
            {resultSummary}
          </p>
        )}

        {showMetadata && command.cwd && (
          <small className="conversation-command-output__cwd">cwd · {command.cwd}</small>
        )}

        <div className="conversation-command-output__terminal">
          {output ? (
            <pre>{output}</pre>
          ) : (
            <p>{state.running ? "正在等待命令输出…" : "命令没有输出。"}</p>
          )}
        </div>

        {(command.stdoutTruncated || command.stderrTruncated) && (
          <small className="conversation-command-output__note">
            {showMetadata
              ? "输出已截断，完整内容保存在 Tool Receipt 中。"
              : "输出较长，当前仅显示部分内容。"}
          </small>
        )}
      </div>
    </details>
  );
}
