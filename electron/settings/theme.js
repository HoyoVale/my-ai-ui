import {
  nativeTheme
} from "electron";

export function resolveMainTheme(
  settings
) {
  const selected =
    settings
      .appearance
      .theme;

  if (selected === "dark") {
    return "dark";
  }

  if (selected === "light") {
    return "light";
  }

  return nativeTheme
    .shouldUseDarkColors
      ? "dark"
      : "light";
}
