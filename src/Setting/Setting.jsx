import { useState } from "react";

import { SettingsContent } from "./components/Content.jsx";
import { SettingsSidebar } from "./components/Sidebar.jsx";
import { SettingsTopbar } from "./components/Topbar.jsx";
import { useWindowMaximized } from "./hooks/useWindowMaximized.js";
import "./Setting.css";

export default function Setting() {
  const [activeTab, setActiveTab] =
    useState("general");

  const [collapsed, setCollapsed] =
    useState(false);

  const isMaximized =
    useWindowMaximized();

  return (
    <div
      className={
        `setting-shell${
          isMaximized
            ? " is-maximized"
            : ""
        }`
      }
    >
      <SettingsTopbar
        collapsed={collapsed}
        isMaximized={isMaximized}
        onToggleSidebar={() => {
          setCollapsed(
            (current) => !current
          );
        }}
        onMinimize={() => {
          window.api?.minimizeWindow?.();
        }}
        onMaximize={() => {
          window.api?.maximizeWindow?.();
        }}
        onClose={() => {
          window.api?.closeWindow?.();
        }}
      />

      <div className="setting-layout">
        <SettingsSidebar
          collapsed={collapsed}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        <SettingsContent
          activeTab={activeTab}
        />
      </div>
    </div>
  );
}
