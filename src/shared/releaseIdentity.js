export const APP_ID = "com.hoyo.xixi.desktop";
export const PRODUCT_NAME = "Xixi Desktop";
export const RELEASE_CHANNELS = Object.freeze([
  "stable",
  "beta",
  "alpha"
]);

export function resolveReleaseChannel(
  version,
  override = ""
) {
  const requested = String(override ?? "")
    .trim()
    .toLowerCase();

  if (RELEASE_CHANNELS.includes(requested)) {
    return requested;
  }

  const normalized = String(version ?? "")
    .trim()
    .toLowerCase();

  if (/(?:^|[-.])alpha(?:[.-]|$)/u.test(normalized)) {
    return "alpha";
  }

  if (/(?:^|[-.])(?:beta|rc)(?:[.-]|$)/u.test(normalized)) {
    return "beta";
  }

  return "stable";
}
