const LATIN_FONT_STACKS = Object.freeze({
  system: ["Segoe UI Variable", "Segoe UI", "Inter", "Arial"],
  segoe: ["Segoe UI Variable", "Segoe UI", "Arial"],
  inter: ["Inter", "Segoe UI Variable", "Segoe UI", "Arial"],
  arial: ["Arial", "Helvetica"],
  georgia: ["Georgia", "Times New Roman"],
  cascadia: ["Cascadia Code", "SFMono-Regular", "Consolas", "Liberation Mono"]
});

const CHINESE_FONT_STACKS = Object.freeze({
  system: ["PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC"],
  yahei: ["Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC"],
  pingfang: ["PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI"],
  notoSans: ["Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei UI"],
  sourceHanSans: ["Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei UI"],
  song: ["Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "SimSun"]
});

const DENSITY_FACTORS = Object.freeze({
  compact: 0.86,
  comfortable: 1,
  spacious: 1.16
});

function normalizedCustom(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function quoteFontName(value) {
  const font = String(value ?? "").trim();
  if (!font) return "";
  if (/^(?:serif|sans-serif|monospace|system-ui|ui-sans-serif|ui-serif|ui-monospace)$/u.test(font)) {
    return font;
  }
  if (/^['"].*['"]$/u.test(font)) return font;
  return /\s/u.test(font)
    ? JSON.stringify(font)
    : font;
}

function joinFontStack(values, generic) {
  return [...values, generic]
    .map(quoteFontName)
    .filter(Boolean)
    .join(", ");
}

function latinStack(appearance = {}) {
  const family = appearance.latinFontFamily ?? "system";
  const custom = normalizedCustom(appearance.customLatinFontFamily);
  return family === "custom" && custom.length
    ? custom
    : LATIN_FONT_STACKS[family] ?? LATIN_FONT_STACKS.system;
}

function chineseStack(appearance = {}) {
  const family = appearance.chineseFontFamily ?? "system";
  const custom = normalizedCustom(appearance.customChineseFontFamily);
  return family === "custom" && custom.length
    ? custom
    : CHINESE_FONT_STACKS[family] ?? CHINESE_FONT_STACKS.system;
}

function latinGeneric(appearance = {}) {
  if (appearance.latinFontFamily === "georgia") return "serif";
  if (appearance.latinFontFamily === "cascadia") return "monospace";
  return "sans-serif";
}

function chineseGeneric(appearance = {}) {
  return appearance.chineseFontFamily === "song" ? "serif" : "sans-serif";
}

export function resolveLatinFontFamily(appearance = {}) {
  return joinFontStack(latinStack(appearance), latinGeneric(appearance));
}

export function resolveChineseFontFamily(appearance = {}) {
  return joinFontStack(chineseStack(appearance), chineseGeneric(appearance));
}

export function resolveFontFamily(appearance = {}) {
  // Keep generic families at the very end. Putting `sans-serif` between the
  // Latin and CJK stacks makes the browser stop before the selected CJK font.
  return joinFontStack(
    [...latinStack(appearance), ...chineseStack(appearance)],
    latinGeneric(appearance)
  );
}

export function getWindowTypography(settings, windowId) {
  const appearance = settings?.appearance ?? {};
  const typography = appearance.typography?.[windowId] ?? {
    fontSize: 14,
    lineHeight: 1.5,
    density: "comfortable"
  };

  return {
    latinFontFamily: resolveLatinFontFamily(appearance),
    chineseFontFamily: resolveChineseFontFamily(appearance),
    fontFamily: resolveFontFamily(appearance),
    fontSize: Number(typography.fontSize) || 14,
    lineHeight: Number(typography.lineHeight) || 1.5,
    letterSpacing: Number.isFinite(Number(typography.letterSpacing))
      ? Number(typography.letterSpacing)
      : 0,
    density: typography.density ?? "comfortable",
    densityFactor: DENSITY_FACTORS[typography.density] ?? 1,
    contentWidth: Number(typography.contentWidth) || null,
    messageSpacing: Number(typography.messageSpacing) || null,
    paragraphSpacing: Number(typography.paragraphSpacing) || null
  };
}

export function getWindowTypographyStyle(settings, windowId) {
  const typography = getWindowTypography(settings, windowId);
  const style = {
    "--app-latin-font-family": typography.latinFontFamily,
    "--app-cjk-font-family": typography.chineseFontFamily,
    "--app-font-family": typography.fontFamily,
    "--app-font-size": `${typography.fontSize}px`,
    "--app-line-height": typography.lineHeight,
    "--app-density-factor": typography.densityFactor,
    letterSpacing: `${typography.letterSpacing}em`
  };

  if (windowId === "conversation") {
    style["--conversation-content-width"] = `${typography.contentWidth ?? 768}px`;
    style["--conversation-message-spacing"] = `${typography.messageSpacing ?? 34}px`;
    style["--conversation-paragraph-spacing"] = `${typography.paragraphSpacing ?? 1}em`;
  }

  return style;
}
