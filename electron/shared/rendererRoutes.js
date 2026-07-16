import {
  mainEnv
} from "../config/env.js";

function normalizeBaseUrl(url) {
  return String(url).replace(
    /\/+$/,
    ""
  );
}

export function getRendererUrl(
  route = "/"
) {
  const baseUrl =
    normalizeBaseUrl(
      mainEnv.DEV_SERVER_URL
    );

  if (
    !route ||
    route === "/"
  ) {
    return baseUrl;
  }

  const normalizedRoute =
    route.startsWith("/")
      ? route
      : `/${route}`;

  return `${baseUrl}/#${normalizedRoute}`;
}
