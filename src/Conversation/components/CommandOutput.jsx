import {
  commandPreview
} from "./commandOutputModel.js";

function outputText(command) {
  const stdout = String(command?.stdout ?? "").trimEnd();
  const stderr = String(command?.stderr ?? "").trimEnd();
  return [stdout, stderr].filter(Boolean).join(stdout && stderr ? "\n" : "");
}

export function ToolCommandPreview({ tool, compact = false, defaultOpen = false }) {
  const command = commandPreview(tool);
  if (!command) return null;
  const output = outputText(command);
  const running = command.exitCode === undefined || command.exitCode === null;
  const succeeded = !running && Number(command.exitCode) === 0 && command.terminated !== true;
  const status = running
    ? "运行中"
    : succeeded
      ? "已完成"
      : `退出码 ${command.exitCode}`;

  return (
    <details
      className={`conversation-command-output${compact ? " is-compact" : ""}`}
      open={defaultOpen || undefined}
      data-testid="conversation-command-output"
    >
      <summary>
        <span className={`conversation-command-output__status is-${running ? "running" : succeeded ? "success" : "attention"}`} />
        <code>$ {command.displayCommand}</code>
        <small>{status}</small>
      </summary>
      <div className="conversation-command-output__body">
        {command.cwd && <small>cwd · {command.cwd}</small>}
        {output ? (
          <pre>{output}</pre>
        ) : (
          <p>{running ? "正在等待命令输出…" : "命令没有输出。"}</p>
        )}
        {(command.stdoutTruncated || command.stderrTruncated) && (
          <small>输出已截断，完整结果保存在 Tool Receipt 中。</small>
        )}
      </div>
    </details>
  );
}
