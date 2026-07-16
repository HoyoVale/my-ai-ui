import {
  registerInputIpc
} from "./handlers/inputIpc.js";

import {
  registerPetIpc
} from "./handlers/petIpc.js";

import {
  registerResponseIpc
} from "./handlers/responseIpc.js";

import {
  registerSettingIpc
} from "./handlers/settingIpc.js";

import {
  registerWindowIpc
} from "./handlers/windowIpc.js";

let registered = false;

export function registerIpcHandlers() {
  if (registered) {
    return;
  }

  registered = true;

  registerPetIpc();
  registerInputIpc();
  registerResponseIpc();
  registerSettingIpc();
  registerWindowIpc();
}
