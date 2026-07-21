import {
  Menu,
  Tray,
  app,
  nativeImage
} from "electron";

import path from "node:path";

import {
  resolveAssistantDisplayName
} from "../../../src/shared/appIdentity.js";

import { openConversationWindow } from "../conversation/conversationWindow.js";
import { openInputWindow } from "../input/inputWindow.js";
import { getPetWindow, createPetWindow } from "../pet/petWindow.js";
import { openSettingWindow } from "../setting/settingWindow.js";

let tray = null;
let assistantName = "桌面助手";
const observedPetWindows = new WeakSet();

function petVisible() {
  const pet = getPetWindow();
  return Boolean(pet && !pet.isDestroyed() && pet.isVisible());
}

function observePetWindow() {
  const pet = getPetWindow();
  if (!pet || pet.isDestroyed() || observedPetWindows.has(pet)) {
    return;
  }

  observedPetWindows.add(pet);
  pet.on("show", updateTrayMenu);
  pet.on("hide", updateTrayMenu);
  pet.on("closed", updateTrayMenu);
}

function showPet() {
  const pet = createPetWindow();
  observePetWindow();
  pet?.show();
  pet?.focus();
  updateTrayMenu();
}

function togglePet() {
  const pet = getPetWindow();
  if (!pet || pet.isDestroyed()) {
    showPet();
    return;
  }
  if (pet.isVisible()) {
    pet.hide();
  } else {
    pet.show();
    pet.focus();
  }
  updateTrayMenu();
}

function trayIcon() {
  const iconPath = path.join(
    app.getAppPath(),
    "public",
    "icon-32x32.png"
  );
  const image = nativeImage.createFromPath(iconPath);
  return image.isEmpty() ? image : image.resize({ width: 20, height: 20, quality: "best" });
}

function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  tray.setToolTip(assistantName);
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: petVisible() ? "隐藏桌宠" : "显示桌宠",
      click: togglePet
    },
    { type: "separator" },
    { label: "输入消息", click: () => openInputWindow() },
    { label: "打开会话", click: () => openConversationWindow() },
    { label: "设置", click: () => openSettingWindow() },
    { type: "separator" },
    {
      label: `退出 ${assistantName}`,
      click: () => {
        app.quit();
      }
    }
  ]));
}

export function applyTraySettings(settings = {}) {
  const enabled = settings.pet?.showInTray !== false;
  assistantName = resolveAssistantDisplayName(settings);

  if (!enabled) {
    destroyTray();
    return;
  }
  if (!tray || tray.isDestroyed()) {
    tray = new Tray(trayIcon());
    tray.on("click", togglePet);
    tray.on("double-click", showPet);
  }
  observePetWindow();
  updateTrayMenu();
}

export function destroyTray() {
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
  }
  tray = null;
}

export function hasActiveTray() {
  return Boolean(tray && !tray.isDestroyed());
}
