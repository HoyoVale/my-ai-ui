export const rendererEnv =
  Object.freeze({
    DEV_SERVER_URL:
      import.meta.env
        .VITE_DEV_SERVER_URL ??
      "http://localhost:5173"
  });
