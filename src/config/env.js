function parseNumber(value, fallback) {
  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : fallback;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }

  return value === "true";
}

export const rendererEnv = Object.freeze({
  DEV_SERVER_URL: import.meta.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173"
});