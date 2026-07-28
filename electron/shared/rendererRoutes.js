import { app } from "electron";

import {
  mainEnv
} from "../config/env.js";

import {
  resolveRendererTarget
} from "./rendererTarget.js";

export function getRendererUrl(
  route = "/"
) {
  return resolveRendererTarget({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    devServerUrl: mainEnv.DEV_SERVER_URL,
    route
  });
}
