import {
  SETTING_TABS
} from "../constants/Tabs.js";

import {
  AboutPanel
} from "../panels/AboutPanel.jsx";

import {
  AppearancePanel
} from "../panels/AppearancePanel.jsx";

import {
  ConversationPanel
} from "../panels/ConversationPanel.jsx";



import {
  DeveloperPanel
} from "../panels/DeveloperPanel.jsx";

import {
  GeneralPanel
} from "../panels/GeneralPanel.jsx";

import {
  InputPanel
} from "../panels/InputPanel.jsx";

import {
  ModelPanel
} from "../panels/ModelPanel.jsx";

import {
  MemoryPanel
} from "../panels/MemoryPanel.jsx";

import {
  McpPanel
} from "../panels/McpPanel.jsx";

import {
  PetPanel
} from "../panels/PetPanel.jsx";

import {
  PersonalityPanel
} from "../panels/PersonalityPanel.jsx";

import {
  ResponsePanel
} from "../panels/ResponsePanel.jsx";

import {
  ToolPanel
} from "../panels/ToolPanel.jsx";

import {
  WorkContextPanel
} from "../panels/WorkContextPanel.jsx";

export function SettingsContent({
  activeTab,
  settings,
  appInfo,
  onUpdateSection,
  onReset
}) {
  const tab =
    SETTING_TABS.find(
      (item) =>
        item.id === activeTab
    ) ?? SETTING_TABS[0];

  const panel = {
    general: (
      <GeneralPanel
        settings={settings}
        appInfo={appInfo}
        onUpdate={(patch) => {
          onUpdateSection(
            "general",
            patch
          );
        }}
        onReset={onReset}
      />
    ),

    appearance: (
      <AppearancePanel
        settings={settings}
        onUpdate={(patch) => {
          onUpdateSection(
            "appearance",
            patch
          );
        }}
      />
    ),

    pet: (
      <PetPanel
        settings={settings}
        onUpdate={(patch) => {
          onUpdateSection(
            "pet",
            patch
          );
        }}
      />
    ),

    input: (
      <InputPanel
        settings={settings}
        onUpdate={(patch) => {
          onUpdateSection(
            "input",
            patch
          );
        }}
      />
    ),

    response: (
      <ResponsePanel
        settings={settings}
        onUpdate={(patch) => {
          onUpdateSection(
            "response",
            patch
          );
        }}
      />
    ),


    workspace: (
      <WorkContextPanel
        settings={settings}
      />
    ),

    personality: (
      <PersonalityPanel
        settings={settings}
        developerMode={
          settings.general.developerMode
        }
        onUpdate={(patch) => {
          onUpdateSection(
            "personality",
            patch
          );
        }}
      />
    ),

    model: (
      <ModelPanel
        settings={settings}
        onUpdate={(patch) => {
          onUpdateSection(
            "model",
            patch
          );
        }}
      />
    ),

    conversation: (
      <ConversationPanel
        developerMode={
          settings.general
            .developerMode
        }
        conversationSettings={
          settings.conversation
        }
        contextSettings={
          settings.context
        }
        onUpdateConversation={(patch) => {
          onUpdateSection(
            "conversation",
            patch
          );
        }}
        onUpdateContext={(patch) => {
          onUpdateSection(
            "context",
            patch
          );
        }}
      />
    ),

    tools: (
      <ToolPanel
        settings={settings.tools}
        appSettings={settings}
        customToolSettings={settings.customTools}
        developerMode={
          settings.general
            .developerMode
        }
        onUpdate={(patch) => {
          onUpdateSection(
            "tools",
            patch
          );
        }}
        onUpdateMcp={(patch) => {
          onUpdateSection(
            "mcp",
            patch
          );
        }}
        onUpdateCustomTools={(patch) => {
          onUpdateSection(
            "customTools",
            patch
          );
        }}
      />
    ),

    mcp: (
      <McpPanel
        settings={settings}
        developerMode={
          settings.general
            .developerMode
        }
        onUpdate={(patch) => {
          onUpdateSection(
            "mcp",
            patch
          );
        }}
      />
    ),

    developer: (
      <DeveloperPanel
        settings={settings}
        onUpdatePrompts={(patch) => {
          onUpdateSection(
            "prompts",
            patch
          );
        }}
      />
    ),

    memory: (
      <MemoryPanel
        settings={settings}
        developerMode={
          settings.general.developerMode
        }
        onUpdate={(patch) => {
          onUpdateSection(
            "memory",
            patch
          );
        }}
      />
    ),

    about: (
      <AboutPanel
        appInfo={appInfo}
      />
    )
  }[activeTab];

  return (
    <main className="setting-content">
      <div className="setting-content__scroll">
        <section className="setting-page">
          <header className="setting-page__header">
            <h1>{tab.title}</h1>

            <p>
              {tab.description}
            </p>
          </header>

          <div className="setting-page__body">
            {panel}
          </div>
        </section>
      </div>
    </main>
  );
}
