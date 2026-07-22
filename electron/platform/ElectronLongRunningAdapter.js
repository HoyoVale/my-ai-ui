import {
  BrowserWindow,
  Notification,
  net,
  powerMonitor
} from "electron";

import IPC_CHANNELS from "../shared/ipcChannels.cjs";

export function deliverNativePlatformNotification(notification) {
  if (!Notification.isSupported()) return { ok: false, code: "notification-unsupported" };
  const native = new Notification({
    title: String(notification?.title ?? "Agent 通知"),
    body: String(notification?.body ?? ""),
    silent: notification?.level === "info"
  });
  native.on("click", () => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
      window.show?.();
      window.focus?.();
      window.webContents.send(IPC_CHANNELS.platform.VIEW_REQUESTED, "run");
    }
  });
  native.on("failed", (_event, error) => {
    console.warn("Native Agent notification failed:", error);
  });
  native.show();
  return { ok: true };
}

export function createElectronLongRunningLifecycleAdapter({ pollIntervalMs = 15_000 } = {}) {
  let pollTimer = null;
  let lastOnline = true;
  const listeners = [];

  return {
    getState() {
      lastOnline = net.isOnline();
      return {
        online: lastOnline,
        suspended: false,
        onBattery: powerMonitor.isOnBatteryPower()
      };
    },

    subscribe({ onNetworkChange, onSuspend, onResume, onPowerChange } = {}) {
      const emitNetwork = () => {
        const online = net.isOnline();
        if (online !== lastOnline) {
          lastOnline = online;
          onNetworkChange?.(online);
        }
      };
      const suspend = () => onSuspend?.();
      const resume = () => {
        emitNetwork();
        onResume?.({
          online: net.isOnline(),
          onBattery: powerMonitor.isOnBatteryPower()
        });
      };
      const battery = () => onPowerChange?.(true);
      const ac = () => onPowerChange?.(false);

      powerMonitor.on("suspend", suspend);
      powerMonitor.on("resume", resume);
      powerMonitor.on("on-battery", battery);
      powerMonitor.on("on-ac", ac);
      listeners.push(["suspend", suspend], ["resume", resume], ["on-battery", battery], ["on-ac", ac]);
      pollTimer = setInterval(emitNetwork, Math.max(2_000, Number(pollIntervalMs) || 15_000));
      pollTimer.unref?.();

      return () => {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        for (const [event, listener] of listeners.splice(0)) {
          powerMonitor.removeListener(event, listener);
        }
      };
    }
  };
}
