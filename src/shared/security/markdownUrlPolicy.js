function parseUrl(value) {
  try {
    return new URL(
      String(value ?? ""),
      window.location.href
    );
  } catch {
    return null;
  }
}

export function safeMarkdownUrlTransform(
  url,
  key
) {
  if (key === "src") {
    return String(url ?? "");
  }

  const parsed = parseUrl(url);

  if (
    !parsed ||
    ![
      "http:",
      "https:"
    ].includes(parsed.protocol)
  ) {
    return "";
  }

  return parsed.toString();
}
