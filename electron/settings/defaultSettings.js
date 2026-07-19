import {
  FALLBACK_SETTINGS
} from "../../src/shared/defaultSettings.js";

export const DEFAULT_SETTINGS =
  FALLBACK_SETTINGS;

export function cloneDefaultSettings() {
  return structuredClone(
    DEFAULT_SETTINGS
  );
}
