import {
  SETTING_GROUPS
} from "../constants/Tabs.js";

import {
  Icon
} from "./Icon.jsx";

export function SettingsSidebar({
  collapsed,
  activeTab,
  onTabChange
}) {
  return (
    <aside
      className={
        `setting-sidebar${
          collapsed
            ? " is-collapsed"
            : ""
        }`
      }
    >
      <div className="setting-sidebar__title">
        Settings
      </div>

      <nav
        className="setting-sidebar__nav"
        aria-label="Settings navigation"
      >
        {SETTING_GROUPS.map(
          (group) => (
            <div
              className="setting-sidebar__group"
              key={group.id}
            >
              <div className="setting-sidebar__group-label">
                {group.label}
              </div>

              {group.tabs.map(
                (tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={
                      `setting-sidebar__item${
                        activeTab === tab.id
                          ? " is-active"
                          : ""
                      }`
                    }
                    onClick={() => {
                      onTabChange(
                        tab.id
                      );
                    }}
                  >
                    <span className="setting-sidebar__icon">
                      <Icon
                        name={tab.id}
                      />
                    </span>

                    <span>
                      {tab.label}
                    </span>
                  </button>
                )
              )}
            </div>
          )
        )}
      </nav>

      <div className="setting-sidebar__version">
        Xixi · v0.1.0
      </div>
    </aside>
  );
}
