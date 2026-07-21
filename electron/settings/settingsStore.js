import {
  app
} from "electron";

import fs from "node:fs";
import path from "node:path";

import {
  recoverAtomicSettingsFile,
  writeSettingsJsonAtomic
} from "./settingsFileWriter.js";

import {
  cloneDefaultSettings
} from "./defaultSettings.js";

import {
  sanitizeSettings
} from "./validateSettings.js";

let cachedSettings = null;

function clone(value) {
  return structuredClone(value);
}

function deepMerge(
  target,
  patch
) {
  if (
    !patch ||
    typeof patch !== "object" ||
    Array.isArray(patch)
  ) {
    return patch;
  }

  const output = {
    ...target
  };

  for (
    const [
      key,
      value
    ]
    of Object.entries(patch)
  ) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      output[key] =
        deepMerge(
          output[key],
          value
        );
    } else {
      output[key] = value;
    }
  }

  return output;
}

export function getSettingsPath() {
  return path.join(
    app.getPath("userData"),
    "settings.json"
  );
}

function writeSettingsFile(
  settings
) {
  writeSettingsJsonAtomic(
    getSettingsPath(),
    settings
  );
}

function loadSettings() {
  if (cachedSettings) {
    return cachedSettings;
  }

  const settingsPath =
    getSettingsPath();

  try {
    recoverAtomicSettingsFile(
      settingsPath
    );

    const text =
      fs.readFileSync(
        settingsPath,
        "utf8"
      );

    const parsed =
      JSON.parse(text);

    cachedSettings =
      sanitizeSettings(parsed);
  } catch (error) {
    if (
      error?.code !== "ENOENT"
    ) {
      console.warn(
        "读取设置文件失败，将使用默认设置：",
        error
      );
    }

    cachedSettings =
      cloneDefaultSettings();
  }

  try {
    writeSettingsFile(
      cachedSettings
    );
  } catch (error) {
    console.warn(
      "写入设置文件失败：",
      error
    );
  }

  return cachedSettings;
}

export function getSettings() {
  return clone(
    loadSettings()
  );
}

export function updateSettings(
  patch
) {
  const current =
    loadSettings();

  const nextSettings =
    sanitizeSettings(
      deepMerge(
        current,
        patch
      )
    );

  writeSettingsFile(
    nextSettings
  );

  cachedSettings =
    nextSettings;

  return getSettings();
}

export function resetSettings() {
  const nextSettings =
    cloneDefaultSettings();

  writeSettingsFile(
    nextSettings
  );

  cachedSettings =
    nextSettings;

  return getSettings();
}
