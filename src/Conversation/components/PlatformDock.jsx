import {
  useEffect,
  useMemo,
  useState
} from "react";

function duration(ms) {
  const seconds = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function budgetText(budget = {}) {
  const parts = [];
  if (budget.tokenLimit > 0) {
    parts.push(`${budget.tokensUsed}/${budget.tokenLimit} tokens`);
  }
  if (budget.stepLimit > 0) {
    parts.push(`${budget.stepsUsed}/${budget.stepLimit} steps`);
  }
  if (budget.timeLimitMs > 0) {
    parts.push(`${duration(budget.elapsedMs)}/${duration(budget.timeLimitMs)}`);
  }
  return parts.join(" · ") || "未设置预算上限";
}

function statusLabel(status) {
  return ({
    queued: "排队中",
    running: "运行中",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
    ready: "待执行",
    review: "待审查",
    blocked: "已阻塞",
    continuable: "可继续"
  })[status] ?? status ?? "未知";
}

export function ConversationPlatformDock({
  conversation,
  developerMode = false
}) {
  const [state, setState] = useState(null);
  const [run, setRun] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [requestedView, setRequestedView] = useState("run");
  const [busyJobId, setBusyJobId] = useState("");
  const [error, setError] = useState("");

  const refresh = async () => {
    const snapshot = await window.api?.getPlatformState?.();
    if (snapshot) setState(snapshot);
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      const snapshot = await window.api?.getPlatformState?.();
      if (active && snapshot) setState(snapshot);
    };
    void load();
    const unsubscribe = window.api?.onPlatformChanged?.(() => {
      void load();
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => window.api?.onPlatformViewRequested?.((view) => {
    if (!["agents", "tasks", "worktrees", "run", "review", "artifacts"].includes(view)) {
      return;
    }
    setRequestedView(view);
    setExpanded(true);
  }), []);

  const runId = conversation?.goal?.platformRunId ??
    state?.runs?.find((item) => item.conversationId === conversation?.id)?.id ??
    "";

  useEffect(() => {
    let active = true;
    if (!runId) {
      setRun(null);
      return undefined;
    }
    void window.api?.getPlatformRun?.(runId).then((value) => {
      if (active) setRun(value ?? null);
    });
    return () => {
      active = false;
    };
  }, [runId, state?.revision]);

  useEffect(() => {
    setExpanded(false);
    setError("");
  }, [conversation?.id]);

  const jobs = useMemo(
    () => (state?.jobs ?? []).filter((job) => job.platformRunId === runId),
    [runId, state?.jobs]
  );
  const worktrees = useMemo(
    () => (state?.worktrees ?? []).filter((item) => item.platformRunId === runId),
    [runId, state?.worktrees]
  );
  if (!run) return null;

  const tasks = Object.values(run.tasks ?? {});
  const agents = Object.values(run.agentRuns ?? {});
  const runningTasks = tasks.filter((task) => ["ready", "running"].includes(task.status)).length;
  const waitingReview = tasks.filter((task) =>
    task.role === "reviewer" && ["pending", "ready", "running", "review"].includes(task.status)
  ).length;
  const blocked = tasks.filter((task) => ["blocked", "failed", "continuable"].includes(task.status)).length;
  const runningJobs = jobs.filter((job) => ["queued", "running"].includes(job.status)).length;
  const summary = [
    runningTasks || runningJobs ? `正在运行 ${Math.max(runningTasks, runningJobs)} 个任务` : "当前没有运行中的后台任务",
    waitingReview ? `${waitingReview} 个等待审查` : "",
    blocked ? `${blocked} 个需要处理` : ""
  ].filter(Boolean).join("，");

  const control = async (jobId, action) => {
    setBusyJobId(jobId);
    setError("");
    try {
      const result = await window.api?.controlPlatformJob?.({ jobId, action });
      if (!result?.ok) setError(result?.code ?? "操作失败");
      await refresh();
    } finally {
      setBusyJobId("");
    }
  };

  return (
    <section
      className={`conversation-platform-dock${expanded ? " is-expanded" : ""}`}
      data-testid="conversation-platform-dock"
      data-developer-mode={developerMode}
      data-requested-view={requestedView}
    >
      <button
        type="button"
        className="conversation-platform-dock__summary"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="conversation-platform-dock__pulse" aria-hidden="true" />
        <span>
          <strong>平台运行</strong>
          <small>{summary}</small>
        </span>
        <em>{statusLabel(run.status)}</em>
      </button>

      {expanded && (
        <div className="conversation-platform-dock__body">
          <nav className="conversation-platform-dock__views" aria-label="平台视图">
            {[
              ["run", "运行"],
              ["tasks", "任务"],
              ["agents", "Agents"],
              ["worktrees", "Worktrees"],
              ["review", "审查"],
              ["artifacts", "Artifacts"]
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={requestedView === id ? "is-active" : ""}
                onClick={() => setRequestedView(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          {error && <p className="conversation-platform-dock__error">{error}</p>}

          <section>
            <header><strong>后台任务</strong><span>{jobs.length}</span></header>
            {jobs.length === 0 ? <p>当前运行没有后台 Job。</p> : jobs.map((job) => (
              <article key={job.id} className={`is-${job.status}`}>
                <div>
                  <strong>{job.title}</strong>
                  <small>{statusLabel(job.status)} · 尝试 {job.attempt}/{job.maxAttempts}</small>
                  <small>{budgetText(job.budget)}</small>
                </div>
                <div className="conversation-platform-dock__actions">
                  {job.status === "running" && <button type="button" disabled={busyJobId === job.id} onClick={() => void control(job.id, "pause")}>暂停</button>}
                  {job.status === "queued" && <button type="button" disabled={busyJobId === job.id} onClick={() => void control(job.id, "pause")}>暂停</button>}
                  {job.status === "paused" && <button type="button" disabled={busyJobId === job.id} onClick={() => void control(job.id, "resume")}>继续</button>}
                  {job.status === "failed" && <button type="button" disabled={busyJobId === job.id || job.attempt >= job.maxAttempts} onClick={() => void control(job.id, "retry")}>重试</button>}
                  {["queued", "running", "paused"].includes(job.status) && <button type="button" disabled={busyJobId === job.id} onClick={() => void control(job.id, "cancel")}>取消</button>}
                </div>
              </article>
            ))}
          </section>

          <section>
            <header><strong>集成与审查</strong></header>
            <p>
              集成：{statusLabel(run.integration?.status ?? "not-required")} ·
              审查：{run.reviews?.at(-1)?.approved === true ? "已通过" : waitingReview ? "等待中" : "未通过或未开始"}
            </p>
            {run.integration?.conflicts?.length > 0 && (
              <p className="conversation-platform-dock__error">冲突：{run.integration.conflicts.join("、")}</p>
            )}
          </section>

          {developerMode && (
            <>
              <section>
                <header><strong>Agents / Tasks</strong><span>{agents.length} / {tasks.length}</span></header>
                {[...tasks].sort((a, b) => a.createdAt - b.createdAt).map((task) => {
                  const agent = [...agents].reverse().find((item) => item.taskId === task.id);
                  return (
                    <article key={task.id}>
                      <div>
                        <strong>{task.title}</strong>
                        <small>{task.role} · {statusLabel(task.status)} · {agent?.modelSelection?.providerId ?? "—"}/{agent?.modelSelection?.modelConfigId ?? "—"}</small>
                        <code>{task.id}</code>
                      </div>
                    </article>
                  );
                })}
              </section>

              <section>
                <header><strong>Worktrees / Leases</strong><span>{worktrees.length} / {state?.activeLeases?.filter((item) => item.platformRunId === runId).length ?? 0}</span></header>
                {worktrees.map((item) => (
                  <article key={item.id}>
                    <div>
                      <strong>{item.role} · {item.status}</strong>
                      <small>{item.branch}</small>
                      <code>{item.checkpointCommit ?? item.baselineCommit}</code>
                    </div>
                  </article>
                ))}
                {(state?.activeLeases ?? []).filter((item) => item.platformRunId === runId).map((lease) => (
                  <p key={lease.id}><code>{lease.resourceKey}</code> · {lease.mode}</p>
                ))}
              </section>

              <section>
                <header><strong>Artifacts / Logs</strong><span>{run.artifacts?.length ?? 0} / {run.logs?.length ?? 0}</span></header>
                {(run.artifacts ?? []).slice(-20).reverse().map((artifact) => (
                  <article key={artifact.id}>
                    <div><strong>{artifact.kind}</strong><small>{artifact.summary || artifact.commit || artifact.digest}</small></div>
                  </article>
                ))}
                <div className="conversation-platform-dock__logs">
                  {(run.logs ?? []).slice(-30).map((log) => (
                    <p key={log.id} className={`is-${log.level}`}><time>{new Date(log.timestamp).toLocaleTimeString()}</time> [{log.source}] {log.message}</p>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </section>
  );
}
