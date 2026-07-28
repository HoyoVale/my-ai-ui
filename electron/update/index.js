import {
  app,
  Notification
} from "electron";

import {
  UpdateService
} from "./UpdateService.js";

export const updateService =
  new UpdateService({
    application: app,
    notificationClass: Notification
  });
