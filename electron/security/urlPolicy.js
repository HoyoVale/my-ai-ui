import net from "node:net";

function isPrivateIpv4(
  hostname
) {
  const parts =
    hostname
      .split(".")
      .map(Number);

  if (
    parts.length !== 4 ||
    parts.some(
      (part) =>
        !Number.isInteger(part) ||
        part < 0 ||
        part > 255
    )
  ) {
    return false;
  }

  const [a, b] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateIpv6(
  hostname
) {
  const value =
    hostname
      .toLowerCase()
      .replace(/^\[|\]$/gu, "");

  return (
    value === "::" ||
    value === "::1" ||
    value.startsWith("fe8") ||
    value.startsWith("fe9") ||
    value.startsWith("fea") ||
    value.startsWith("feb") ||
    value.startsWith("fc") ||
    value.startsWith("fd")
  );
}

export function isLocalOrPrivateHost(
  hostname
) {
  const normalized =
    String(hostname ?? "")
      .toLowerCase()
      .replace(/^\[|\]$/gu, "");

  if (
    normalized === "localhost" ||
    normalized.endsWith(
      ".localhost"
    ) ||
    normalized.endsWith(".local")
  ) {
    return true;
  }

  const ipVersion =
    net.isIP(normalized);

  if (ipVersion === 4) {
    return isPrivateIpv4(
      normalized
    );
  }

  if (ipVersion === 6) {
    return isPrivateIpv6(
      normalized
    );
  }

  return false;
}

export function parseSafeExternalUrl(
  value
) {
  let url;

  try {
    url = new URL(
      String(value ?? "")
    );
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" &&
    url.protocol !== "http:"
  ) {
    return null;
  }

  if (
    url.username ||
    url.password ||
    isLocalOrPrivateHost(
      url.hostname
    )
  ) {
    return null;
  }

  return url;
}

export function isTrustedRendererUrl(
  value,
  trustedOrigins
) {
  let url;

  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (
    [
      "data:",
      "blob:",
      "devtools:"
    ].includes(url.protocol)
  ) {
    return true;
  }

  return trustedOrigins
    .has(url.origin);
}
