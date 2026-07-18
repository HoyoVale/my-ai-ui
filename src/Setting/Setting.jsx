import {
  useEffect,
  useState
} from "react";

import {
  useResolvedTheme
} from "../shared/hooks/useResolvedTheme.js";

import {
  SettingsContent
} from "./components/Content.jsx";

import {
  SettingsSidebar
} from "./components/Sidebar.jsx";

import {
  SettingsTopbar
} from "./components/Topbar.jsx";

import {
  useAppInfo
} from "./hooks/useAppInfo.js";

import {
  useSettings
} from "./hooks/useSettings.js";

import {
  useWindowMaximized
} from "./hooks/useWindowMaximized.js";

import {
  getWindowTypographyStyle
} from "../shared/typography.js";

import "./Setting.css";

export default function Setting() {
  const [
    activeTab,
    setActiveTab
  ] = useState("general");

  const [
    collapsed,
    setCollapsed
  ] = useState(false);

  const isMaximized =
    useWindowMaximized();

  const appInfo =
    useAppInfo();

  const {
    settings,
    status,
    updateSection,
    resetAll
  } = useSettings();

  useEffect(() => {
    if (
      !settings.general.developerMode &&
      activeTab === "developer"
    ) {
      setActiveTab("general");
    }
  }, [
    activeTab,
    settings.general.developerMode
  ]);

  const theme =
    useResolvedTheme(
      settings
        .appearance
        .theme
    );

  return (
    <div
      className={
        [
          "setting-shell",

          isMaximized
            ? "is-maximized"
            : "",

          theme === "dark"
            ? "theme-dark"
            : "",

          settings
            .appearance
            .reducedMotion
            ? "reduce-motion"
            : ""
        ]
          .filter(Boolean)
          .join(" ")
      }
      style={{
        ...getWindowTypographyStyle(
          settings,
          "setting"
        ),

        "--accent":
          settings
            .appearance
            .accentColor
      }}
    >
      <SettingsTopbar
        collapsed={collapsed}
        isMaximized={isMaximized}
        status={status}
        onToggleSidebar={() => {
          setCollapsed(
            (current) =>
              !current
          );
        }}
        onMinimize={() => {
          window.api
            ?.minimizeWindow?.();
        }}
        onMaximize={() => {
          window.api
            ?.maximizeWindow?.();
        }}
        onClose={() => {
          window.api
            ?.closeWindow?.();
        }}
      />

      <div className="setting-layout">
        <SettingsSidebar
          collapsed={collapsed}
          activeTab={activeTab}
          developerMode={
            settings.general
              .developerMode
          }
          onTabChange={
            setActiveTab
          }
        />

        <SettingsContent
          activeTab={activeTab}
          settings={settings}
          appInfo={appInfo}
          onUpdateSection={
            updateSection
          }
          onReset={resetAll}
        />
      </div>
    </div>
  );
}
