import {
  useState
} from "react";

import {
  ActionButton,
  SettingsSection,
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

function SkillCard({
  skill,
  developerMode,
  busy,
  onToggle,
  onUninstall
}) {
  const [confirming, setConfirming] = useState(false);
  const capabilities = [
    ...(skill.requiredCapabilities ?? []),
    ...(skill.optionalCapabilities ?? [])
  ];

  return (
    <article
      className={`skill-card${skill.enabled ? " is-enabled" : ""}${skill.integrity !== "verified" ? " is-warning" : ""}`}
      data-testid={`skill-card-${skill.id}`}
    >
      <header className="skill-card__header">
        <div className="skill-card__identity">
          <div className="skill-card__mark">S</div>
          <div>
            <div className="skill-card__title-line">
              <strong>{skill.name}</strong>
              <code>{skill.id}</code>
              <span>v{skill.version}</span>
            </div>
            <p>{skill.description}</p>
          </div>
        </div>

        <Toggle
          checked={skill.enabled}
          disabled={busy}
          label={`${skill.enabled ? "禁用" : "启用"} ${skill.name}`}
          testId={`skill-toggle-${skill.id}`}
          onChange={onToggle}
        />
      </header>

      <div className="skill-card__meta">
        <span>{skill.modes.map(modeLabel).join(" / ")}</span>
        <span>{skill.requiredCapabilities.length} 项必需能力</span>
        <span className={`skill-integrity is-${skill.integrity}`}>{integrityLabel(skill.integrity)}</span>
      </div>

      {capabilities.length > 0 && (
        <details className="skill-card__details">
          <summary>能力与权限</summary>
          <div className="skill-capability-list">
            {skill.requiredCapabilities.map((capability) => (
              <span key={`required:${capability}`} className="is-required">
                <code>{capability}</code>
                必需
              </span>
            ))}
            {skill.optionalCapabilities.map((capability) => (
              <span key={`optional:${capability}`}>
                <code>{capability}</code>
                可选
              </span>
            ))}
          </div>
          <div className="skill-permission-list">
            {Object.entries(skill.permissions ?? {}).map(([key, level]) => (
              <span key={key} className={`is-${level}`}>
                <code>{key}</code>
                {permissionLabel(level)}
              </span>
            ))}
          </div>
        </details>
      )}

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
    clearFeedback
  } = useSkills(developerMode);

  const busy = Boolean(action);

  return (
    <div className="skills-panel">
      <section className="skills-hero">
        <div>
          <strong>Skills</strong>
          <p>安装由 skill.json 与 SKILL.md 组成的本地能力包。Skill 只能请求 Capability，不能自行提升权限。</p>
        </div>
        <div className="skills-hero__actions">
          <ActionButton
            disabled={busy}
            testId="skill-import-directory"
            onClick={() => {
              clearFeedback();
              void run("import-directory", () => window.api.importSkillDirectory(), "Skill 已安装");
            }}
          >
            导入文件夹
          </ActionButton>
          <ActionButton
            disabled={busy}
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
        <div><span>已启用</span><strong>{state.enabled}</strong></div>
        <div><span>已禁用</span><strong>{state.disabled}</strong></div>
        <div><span>异常</span><strong>{state.invalid}</strong></div>
      </div>

      {error && <p className="skills-message is-error">{error}</p>}
      {message && <p className="skills-message is-success">{message}</p>}

      <SettingsSection title="已安装 Skill">
        {status === "loading" && <p className="skills-empty">正在读取 Skill Registry…</p>}
        {status !== "loading" && state.skills.length === 0 && (
          <div className="skills-empty">
            <strong>尚未安装 Skill</strong>
            <p>导入一个包含 skill.json 与 SKILL.md 的文件夹或 ZIP。</p>
          </div>
        )}

        <div className="skill-list">
          {state.skills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              developerMode={developerMode}
              busy={busy}
              onToggle={(enabled) => {
                void run(`toggle:${skill.id}`, () => window.api.setSkillEnabled(skill.id, enabled));
              }}
              onUninstall={() => {
                void run(`uninstall:${skill.id}`, () => window.api.uninstallSkill(skill.id), "Skill 已卸载");
              }}
            />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="包结构">
        <pre className="skill-package-layout">{`skills/\n└─ example-skill/\n   ├─ skill.json\n   ├─ SKILL.md\n   ├─ resources/\n   ├─ templates/\n   └─ tests/`}</pre>
      </SettingsSection>
    </div>
  );
}
