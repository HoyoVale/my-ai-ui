import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  resolveRendererTarget
} from "../../electron/shared/rendererTarget.js";

test("development renderer routes use the Vite server", () => {
  assert.equal(
    resolveRendererTarget({
      isPackaged: false,
      appPath: "/unused",
      devServerUrl: "http://127.0.0.1:5173/",
      route: "/setting"
    }),
    "http://127.0.0.1:5173/#/setting"
  );
});

test("packaged renderer routes load dist/index.html without localhost", () => {
  const target = resolveRendererTarget({
    isPackaged: true,
    appPath: path.join(path.sep, "opt", "xixi", "resources", "app.asar"),
    devServerUrl: "http://localhost:5173",
    route: "/conversation"
  });
  assert.match(target, /^file:/u);
  assert.match(target, /dist\/index\.html#\/conversation$/u);
  assert.doesNotMatch(target, /localhost/u);
  const parsedPath = fileURLToPath(target.split("#")[0]);
  assert.match(parsedPath, /dist[\\/]index\.html$/u);
});
