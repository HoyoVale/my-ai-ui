import {
  lazy,
  Suspense,
  useLayoutEffect,
  useRef
} from "react";

import {
  SETTING_TABS
} from "../constants/Tabs.js";

const AboutPanel = lazy(() => import("../panels/AboutPanel.jsx").then((module) => ({ default: module.AboutPanel })));
const AppearancePanel = lazy(() => import("../panels/AppearancePanel.jsx").then((module) => ({ default: module.AppearancePanel })));
const ConversationPanel = lazy(() => import("../panels/ConversationPanel.jsx").then((module) => ({ default: module.ConversationPanel })));
const DeveloperPanel = lazy(() => import("../panels/DeveloperPanel.jsx").then((module) => ({ default: module.DeveloperPanel })));
const GeneralPanel = lazy(() => import("../panels/GeneralPanel.jsx").then((module) => ({ default: module.GeneralPanel })));
const InputPanel = lazy(() => import("../panels/InputPanel.jsx").then((module) => ({ default: module.InputPanel })));
const McpPanel = lazy(() => import("../panels/McpPanel.jsx").then((module) => ({ default: module.McpPanel })));
const MemoryPanel = lazy(() => import("../panels/MemoryPanel.jsx").then((module) => ({ default: module.MemoryPanel })));
const ModelPanel = lazy(() => import("../panels/ModelPanel.jsx").then((module) => ({ default: module.ModelPanel })));
const PersonalityPanel = lazy(() => import("../panels/PersonalityPanel.jsx").then((module) => ({ default: module.PersonalityPanel })));
const PetPanel = lazy(() => import("../panels/PetPanel.jsx").then((module) => ({ default: module.PetPanel })));
const ResponsePanel = lazy(() => import("../panels/ResponsePanel.jsx").then((module) => ({ default: module.ResponsePanel })));
const SkillsPanel = lazy(() => import("../panels/SkillsPanel.jsx").then((module) => ({ default: module.SkillsPanel })));
const ToolPanel = lazy(() => import("../panels/ToolPanel.jsx").then((module) => ({ default: module.ToolPanel })));
const WorkContextPanel = lazy(() => import("../panels/WorkContextPanel.jsx").then((module) => ({ default: module.WorkContextPanel })));

function panelForTab({
  activeTab,
  settings,
  appInfo,
  updateSection,
  onReset
}) {
  switch (activeTab) {
    case "general":
      return <GeneralPanel settings={settings} appInfo={appInfo} onUpdate={updateSection("general")} onReset={onReset} />;
    case "appearance":
      return <AppearancePanel settings={settings} onUpdate={updateSection("appearance")} />;
    case "pet":
      return <PetPanel settings={settings} onUpdate={updateSection("pet")} />;
    case "input":
      return <InputPanel settings={settings} onUpdate={updateSection("input")} />;
    case "response":
      return <ResponsePanel settings={settings} onUpdate={updateSection("response")} />;
    case "workspace":
      return <WorkContextPanel settings={settings} />;
    case "personality":
      return <PersonalityPanel settings={settings} developerMode={settings.general.developerMode} onUpdate={updateSection("personality")} />;
    case "model":
      return <ModelPanel settings={settings} onUpdate={updateSection("model")} />;
    case "conversation":
      return (
        <ConversationPanel
          developerMode={settings.general.developerMode}
          conversationSettings={settings.conversation}
          contextSettings={settings.context}
          onUpdateConversation={updateSection("conversation")}
          onUpdateContext={updateSection("context")}
        />
      );
    case "tools":
      return (
        <ToolPanel
          settings={settings.tools}
          appSettings={settings}
          customToolSettings={settings.customTools}
          developerMode={settings.general.developerMode}
          onUpdate={updateSection("tools")}
          onUpdateMcp={updateSection("mcp")}
          onUpdateCustomTools={updateSection("customTools")}
        />
      );
    case "mcp":
      return <McpPanel settings={settings} developerMode={settings.general.developerMode} onUpdate={updateSection("mcp")} />;
    case "skills":
      return <SkillsPanel developerMode={settings.general.developerMode} />;
    case "developer":
      return <DeveloperPanel settings={settings} onUpdatePrompts={updateSection("prompts")} />;
    case "memory":
      return <MemoryPanel settings={settings} developerMode={settings.general.developerMode} onUpdate={updateSection("memory")} />;
    case "about":
      return <AboutPanel appInfo={appInfo} />;
    default:
      return null;
  }
}

export function SettingsContent({
  activeTab,
  settings,
  appInfo,
  onUpdateSection,
  onReset
}) {
  const scrollRef = useRef(null);
  const scrollPositionsRef = useRef(new Map());
  const tab = SETTING_TABS.find((item) => item.id === activeTab) ?? SETTING_TABS[0];
  const updateSection = (section) => (patch) => onUpdateSection(section, patch);
  const panel = panelForTab({ activeTab, settings, appInfo, updateSection, onReset });

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const saved = scrollPositionsRef.current.get(activeTab) ?? 0;
    if (Math.abs(element.scrollTop - saved) > 1) element.scrollTop = saved;
  }, [activeTab]);

  return (
    <main className="setting-content">
      <div
        ref={scrollRef}
        className="setting-content__scroll"
        onScroll={(event) => {
          scrollPositionsRef.current.set(activeTab, event.currentTarget.scrollTop);
        }}
      >
        <section className="setting-page">
          <header className="setting-page__header">
            <h1>{tab.title}</h1>
            <p>{tab.description}</p>
          </header>

          <div className="setting-page__body">
            <Suspense fallback={<div className="settings-panel-loading">正在加载设置…</div>}>
              {panel}
            </Suspense>
          </div>
        </section>
      </div>
    </main>
  );
}
