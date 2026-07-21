import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  ActionButton,
  SettingsSection,
  TextInput,
  Toggle
} from "../components/Controls.jsx";

import {
  useSkills
} from "../hooks/useSkills.js";

function permissionLabel(level) {
  return {
    allow: "允许",
    ask: "询问",
    deny: "拒绝"
  }[level] ?? String(level ?? "拒绝");
}

function modeLabel(mode) {
  return mode === "coding" ? "Coding" : "Chat";
}

function integrityLabel(value) {
  return {
    verified: "已验证",
    changed: "文件已变化",
    missing: "文件缺失",
    invalid: "包无效"
  }[value] ?? value;
}

function RuntimeReport({ report }) {
  if (!report) return null;

  return (
    <div className={`skill-runtime-report${report.failed > 0 ? " is-failed" : " is-passed"}`}>
      <div className="skill-runtime-report__summary">
        <strong>{report.failed > 0 ? "兼容性检查未通过" : "兼容性检查通过"}</strong>
        <span>{report.passed} 通过 · {report.failed} 失败 · {modeLabel(report.mode)}</span>
      </div>
      <div className="skill-runtime-report__facts">
        <span>{report.selectedToolNames?.length ?? 0} 个可用工具</span>
        <span>{report.promptBytes ?? 0} bytes Prompt</span>
        {report.unavailableOptional?.length > 0 && (
          <span>{report.unavailableOptional.length} 项可选能力不可用</span>
        )}
      </div>
      <div className="skill-runtime-report__tests">
        {(report.tests ?? []).map((test) => (
          <div key={test.id} className={`is-${test.status}`}>
            <span>{test.status === "passed" ? "✓" : "!"}</span>
            <strong>{test.title}</strong>
            {test.message && <small>{test.message}</small>}
            {test.missingRequired?.length > 0 && (
              <small>缺少：{test.missingRequired.join("、")}</small>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SkillCard({
  skill,
  developerMode,
  busy,
  report,
  onToggle,
  onTest,
  onUninstall
}) {
  const [confirming, setConfirming] = useState(false);
  const capabilityCount =
    (skill.requiredCapabilities?.length ?? 0) +
    (skill.optionalCapabilities?.length ?? 0);

  return (
    <article
      className={`skill-card${skill.enabled ? " is-enabled" : ""}${skill.integrity !== "verified" ? " is-warning" : ""}`}
      data-testid={`skill-card-${skill.id}`}
    >
      <header className="skill-card__header">
        <div className="skill-card__identity">
          <div className="skill-card__mark" aria-hidden="true">S</div>
          <div className="skill-card__identity-copy">
            <div className="skill-card__title-line">
              <strong>{skill.name}</strong>
              <span className="skill-card__version">v{skill.version}</span>
              <span className={`skill-integrity is-${skill.integrity}`}>
                {integrityLabel(skill.integrity)}
              </span>
            </div>
            <p>{skill.description}</p>
            <code className="skill-card__id">{skill.id}</code>
          </div>
        </div>

        <Toggle
          checked={skill.enabled}
          disabled={Boolean(busy) || (!skill.enabled && skill.integrity !== "verified")}
          label={`${skill.enabled ? "禁用" : "启用"} ${skill.name}`}
          testId={`skill-toggle-${skill.id}`}
          onChange={onToggle}
        />
      </header>

      <div className="skill-card__meta">
        <span className={`skill-runtime-state is-${skill.available ? "available" : "unavailable"}`}>
          {skill.available ? "可运行" : skill.enabled ? "已阻止" : "已禁用"}
        </span>
        <span>{skill.modes.map(modeLabel).join(" / ")}</span>
        <span>{capabilityCount} 项能力</span>
        {skill.dependencies?.length > 0 && (
          <span className={skill.dependencyState?.ok ? "" : "is-warning"}>
            {skill.dependencies.length} 项依赖
          </span>
        )}
      </div>

      <div className="skill-card__runtime-actions">
        <ActionButton
          disabled={busy || !skill.enabled || skill.integrity !== "verified"}
          testId={`skill-runtime-test-${skill.id}`}
          onClick={onTest}
        >
          {busy === `test:${skill.id}` ? "检查中…" : "兼容性检查"}
        </ActionButton>
        <span>使用当前会话的模式、工作区和权限进行只读解析，不执行 Skill。</span>
      </div>

      <RuntimeReport report={report} />

      <details className="skill-card__details">
        <summary>能力与权限</summary>
        <div className="skill-capability-groups">
          <div>
            <strong>必需能力</strong>
            <div className="skill-capability-list">
              {(skill.requiredCapabilities ?? []).map((capability) => (
                <span key={`required:${capability}`} className="is-required">
                  <code>{capability}</code>
                </span>
              ))}
              {!skill.requiredCapabilities?.length && <small>无</small>}
            </div>
          </div>
          <div>
            <strong>可选能力</strong>
            <div className="skill-capability-list">
              {(skill.optionalCapabilities ?? []).map((capability) => (
                <span key={`optional:${capability}`}>
                  <code>{capability}</code>
                </span>
              ))}
              {!skill.optionalCapabilities?.length && <small>无</small>}
            </div>
          </div>
        </div>
        {skill.keywords?.length > 0 && (
          <div className="skill-router-keywords">
            <strong>自动路由关键词</strong>
            <div>
              {skill.keywords.map((keyword) => (
                <code key={keyword}>{keyword}</code>
              ))}
            </div>
            <small>仅用于本地保守匹配；置信度不足时不会自动启用 Skill。</small>
          </div>
        )}
        {skill.dependencies?.length > 0 && (
          <div className="skill-dependency-list">
            <strong>Skill 依赖</strong>
            {skill.dependencies.map((dependency) => (
              <span key={dependency.id} className={dependency.optional ? "is-optional" : "is-required"}>
                <code>{dependency.id}@{dependency.version}</code>
                {dependency.optional ? "可选" : "必需"}
              </span>
            ))}
            {skill.dependencyState?.diagnostics?.map((diagnostic) => (
              <small key={`${diagnostic.code}:${diagnostic.dependencyId ?? diagnostic.skillId ?? ""}`} className="skill-card__error">
                {diagnostic.message}
              </small>
            ))}
          </div>
        )}
        <div className="skill-permission-list">
          {Object.entries(skill.permissions ?? {}).map(([key, level]) => (
            <span key={key} className={`is-${level}`}>
              <code>{key}</code>
              {permissionLabel(level)}
            </span>
          ))}
        </div>
      </details>

      {developerMode && (
        <details className="skill-card__details skill-card__developer">
          <summary>开发者信息</summary>
          <dl>
            <div><dt>来源</dt><dd>{skill.sourceType} · {skill.sourceName || "未知"}</dd></div>
            <div><dt>安装路径</dt><dd><code>{skill.installedPath || "-"}</code></dd></div>
            <div><dt>Manifest</dt><dd><code>{skill.manifestHash || "-"}</code></dd></div>
            <div><dt>Prompt</dt><dd><code>{skill.promptHash || "-"}</code></dd></div>
            <div><dt>Package</dt><dd><code>{skill.packageHash || "-"}</code></dd></div>
            <div><dt>规模</dt><dd>{skill.fileCount} 个文件 · {skill.totalBytes} bytes</dd></div>
          </dl>
          {skill.integrityError && (
            <p className="skill-card__error">{skill.integrityError.code} · {skill.integrityError.message}</p>
          )}
        </details>
      )}

      <footer className="skill-card__actions">
        {confirming ? (
          <>
            <span>确认卸载此 Skill？</span>
            <ActionButton disabled={busy} onClick={() => setConfirming(false)}>取消</ActionButton>
            <ActionButton disabled={busy} tone="danger" onClick={onUninstall}>确认卸载</ActionButton>
          </>
        ) : (
          <ActionButton disabled={busy} tone="danger" onClick={() => setConfirming(true)}>卸载</ActionButton>
        )}
      </footer>
    </article>
  );
}

export function SkillsPanel({ developerMode = false }) {
  const {
    state,
    status,
    action,
    error,
    message,
    run,
    clearFeedback,
    refresh
  } = useSkills(developerMode);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [reports, setReports] = useState({});

  useEffect(() => {
    setReports({});
  }, [state.revision]);

  const filteredSkills = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return state.skills.filter((skill) => {
      const filterMatches =
        filter === "all" ||
        (filter === "available" && skill.available) ||
        (filter === "disabled" && !skill.enabled) ||
        (filter === "issues" && skill.integrity !== "verified");
      const queryMatches = !keyword || [
        skill.name,
        skill.id,
        skill.description,
        ...(skill.requiredCapabilities ?? []),
        ...(skill.optionalCapabilities ?? [])
      ].some((value) => String(value ?? "").toLowerCase().includes(keyword));
      return filterMatches && queryMatches;
    });
  }, [filter, query, state.skills]);

  const busy = action || "";

  const testRuntime = async (skill) => {
    clearFeedback();
    const result = await run(
      `test:${skill.id}`,
      () => window.api.testSkillRuntime(skill.id)
    );
    if (result?.report) {
      setReports((current) => ({ ...current, [skill.id]: result.report }));
    }
  };

  return (
    <div className="skills-panel" aria-busy={Boolean(busy)}>
      <section className="skills-hero">
        <div>
          <span className="skills-hero__eyebrow">Skill Runtime</span>
          <strong>可复用的工作流，不是额外权限</strong>
          <p>Skill 支持显式组合、<code>/skill-id</code> 临时调用、保守自动路由与声明式依赖。所有能力仍继承当前模式、工作区和 Tool Security 权限。</p>
        </div>
        <div className="skills-hero__actions">
          <ActionButton
            disabled={Boolean(busy)}
            onClick={() => {
              clearFeedback();
              void refresh();
            }}
          >
            重新检查
          </ActionButton>
          <ActionButton
            disabled={Boolean(busy)}
            testId="skill-import-directory"
            onClick={() => {
              clearFeedback();
              void run("import-directory", () => window.api.importSkillDirectory(), "Skill 已安装");
            }}
          >
            导入文件夹
          </ActionButton>
          <ActionButton
            disabled={Boolean(busy)}
            testId="skill-import-zip"
            onClick={() => {
              clearFeedback();
              void run("import-zip", () => window.api.importSkillZip(), "Skill 已安装");
            }}
          >
            导入 ZIP
          </ActionButton>
        </div>
      </section>

      <div className="skills-overview">
        <div><span>已安装</span><strong>{state.total}</strong></div>
        <div><span>可运行</span><strong>{state.available}</strong></div>
        <div><span>已禁用</span><strong>{state.disabled}</strong></div>
        <div><span>完整性异常</span><strong>{state.invalid}</strong></div>
        <div><span>依赖异常</span><strong>{state.dependencyIssues ?? 0}</strong></div>
      </div>

      <div className="skills-toolbar">
        <TextInput
          value={query}
          placeholder="搜索名称、ID 或 Capability"
          ariaLabel="搜索 Skill"
          onChange={setQuery}
        />
        <div className="skills-filter" role="group" aria-label="Skill 筛选">
          {[
            ["all", "全部"],
            ["available", "可运行"],
            ["disabled", "已禁用"],
            ["issues", "异常"]
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={filter === value ? "is-active" : ""}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div aria-live="polite">
        {error && <p className="skills-message is-error">{error}</p>}
        {message && <p className="skills-message is-success">{message}</p>}
      </div>

      <SettingsSection title="已安装 Skill">
        {status === "loading" && <p className="skills-empty">正在读取 Skill Registry…</p>}
        {status !== "loading" && state.skills.length === 0 && (
          <div className="skills-empty">
            <strong>尚未安装 Skill</strong>
            <p>导入一个包含 skill.json 与 SKILL.md 的本地文件夹或 ZIP。</p>
          </div>
        )}
        {status !== "loading" && state.skills.length > 0 && filteredSkills.length === 0 && (
          <div className="skills-empty">
            <strong>没有匹配的 Skill</strong>
            <p>调整搜索词或筛选条件。</p>
          </div>
        )}

        <div className="skill-list">
          {filteredSkills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              developerMode={developerMode}
              busy={busy}
              report={reports[skill.id]}
              onToggle={(enabled) => {
                void run(`toggle:${skill.id}`, () => window.api.setSkillEnabled(skill.id, enabled));
              }}
              onTest={() => {
                void testRuntime(skill);
              }}
              onUninstall={() => {
                void run(`uninstall:${skill.id}`, () => window.api.uninstallSkill(skill.id), "Skill 已卸载");
              }}
            />
          ))}
        </div>
      </SettingsSection>

      <details className="skill-package-guide">
        <summary>Skill 包结构与运行边界</summary>
        <div>
          <pre className="skill-package-layout">{`skills/\n└─ example-skill/\n   ├─ skill.json\n   ├─ SKILL.md\n   ├─ resources/\n   ├─ templates/\n   └─ tests/`}</pre>
          <p>SKILL.md 只进入 Skill Prompt Stack；dependencies 只声明其他 Skill，不下载或执行代码。组合最多 4 个根 Skill，依赖按拓扑顺序先加载，权限取最严格交集。</p>
        </div>
      </details>
    </div>
  );
}
