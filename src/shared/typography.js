const FONT_STACKS = {
  system:
    'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif',
  humanist:
    '"Segoe UI Variable", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif',
  serif:
    'Georgia, "Noto Serif SC", "Source Han Serif SC", "Songti SC", serif',
  monospace:
    '"Cascadia Code", "SFMono-Regular", Consolas, "Liberation Mono", monospace'
};

const DENSITY_FACTORS = {
  compact: 0.86,
  comfortable: 1,
  spacious: 1.16
};

export function resolveFontFamily(
  appearance = {}
) {
  if (
    appearance.fontFamily === "custom" &&
    String(
      appearance.customFontFamily ?? ""
    ).trim()
  ) {
    return `${appearance.customFontFamily}, ${FONT_STACKS.system}`;
  }

  return FONT_STACKS[
    appearance.fontFamily
  ] ?? FONT_STACKS.system;
}

export function getWindowTypography(
  settings,
  windowId
) {
  const appearance =
    settings?.appearance ?? {};

  const typography =
    appearance.typography?.[
      windowId
    ] ?? {
      fontSize: 14,
      lineHeight: 1.5,
      density: "comfortable"
    };

  return {
    fontFamily:
      resolveFontFamily(appearance),
    fontSize:
      Number(typography.fontSize) || 14,
    lineHeight:
      Number(typography.lineHeight) || 1.5,
    density:
      typography.density ??
      "comfortable",
    densityFactor:
      DENSITY_FACTORS[
        typography.density
      ] ?? 1
  };
}

export function getWindowTypographyStyle(
  settings,
  windowId
) {
  const typography =
    getWindowTypography(
      settings,
      windowId
    );

  return {
    "--app-font-family":
      typography.fontFamily,
    "--app-font-size":
      `${typography.fontSize}px`,
    "--app-line-height":
      typography.lineHeight,
    "--app-density-factor":
      typography.densityFactor
  };
}
