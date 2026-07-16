import {
  SETTING_TABS
} from "../constants/Tabs.js";

export function SettingsContent({
  activeTab
}) {
  const tab =
    SETTING_TABS.find(
      (item) =>
        item.id === activeTab
    ) ?? SETTING_TABS[0];

  return (
    <main className="setting-content">
      <div className="setting-content__scroll">
        <section className="setting-page">
          <header className="setting-page__header">
            <h1>{tab.label}</h1>

            <p>
              Settings for{" "}
              {tab.label.toLowerCase()}{" "}
              will be placed here.
            </p>
          </header>

          <div className="setting-canvas">
            <div className="setting-canvas__placeholder">
              <span className="setting-canvas__dot" />
              <span>Content area</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
