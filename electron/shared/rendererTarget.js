import path from "node:path";
import { pathToFileURL } from "node:url";

function normalizedRoute(route) {
  const text = String(route ?? "").trim();
  if (!text || text === "/") {
    return "";
  }
  return text.startsWith("/") ? text : `/${text}`;
}

function normalizeBaseUrl(value) {
  return String(value ?? "")
    .trim()
    .replace(/\/+$/u, "");
}

export function resolveRendererTarget({
  isPackaged,
  appPath,
  devServerUrl,
  route = "/"
}) {
  const hashRoute = normalizedRoute(route);

  if (!isPackaged) {
    const baseUrl = normalizeBaseUrl(devServerUrl);
    if (!baseUrl) {
      throw new Error("Renderer development server URL is missing.");
    }
    return hashRoute
      ? `${baseUrl}/#${hashRoute}`
      : baseUrl;
  }

  const root = path.resolve(String(appPath ?? ""));
  const entry = path.join(root, "dist", "index.html");
  const url = pathToFileURL(entry);
  if (hashRoute) {
    url.hash = hashRoute;
  }
  return url.href;
}
