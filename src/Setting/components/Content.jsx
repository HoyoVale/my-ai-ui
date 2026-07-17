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
  GeneralPanel
} from "../panels/GeneralPanel.jsx";

import {
  InputPanel
} from "../panels/InputPanel.jsx";

import {
  ModelPanel
} from "../panels/ModelPanel.jsx";

import {
  PetPanel
} from "../panels/PetPanel.jsx";

import {
  PlaceholderPanel
} from "../panels/PlaceholderPanel.jsx";

import {
  ResponsePanel
} from "../panels/ResponsePanel.jsx";

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

    personality: (
      <PlaceholderPanel
        title="Personality"
        description="后续接入角色提示词、语气和行为规则。"
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
