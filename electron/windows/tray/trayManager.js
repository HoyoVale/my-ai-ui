import {
  Menu,
  Tray,
  app,
  nativeImage
} from "electron";

import path from "node:path";

import { openConversationWindow } from "../conversation/conversationWindow.js";
import { openInputWindow } from "../input/inputWindow.js";
import { getPetWindow, createPetWindow } from "../pet/petWindow.js";
import { openSettingWindow } from "../setting/settingWindow.js";

let tray = null;

function petVisible() {
  const pet = getPetWindow();
  return Boolean(pet && !pet.isDestroyed() && pet.isVisible());
}

function showPet() {
  const pet = createPetWindow();
  pet?.show();
  pet?.focus();
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
  const iconPath = path.join(app.getAppPath(), "assets", "xixi_png.png");
  const image = nativeImage.createFromPath(iconPath);
  return image.isEmpty() ? image : image.resize({ width: 20, height: 20, quality: "best" });
}

function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
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
      label: "退出 Xixi",
      click: () => {
        app.quit();
      }
    }
  ]));
}

export function applyTraySettings(settings = {}) {
  const enabled = settings.pet?.showInTray !== false;
  if (!enabled) {
    destroyTray();
    return;
  }
  if (!tray || tray.isDestroyed()) {
    tray = new Tray(trayIcon());
    tray.setToolTip("Xixi");
    tray.on("click", togglePet);
    tray.on("double-click", showPet);
  }
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
