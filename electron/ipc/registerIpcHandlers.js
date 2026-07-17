import {
  registerAgentIpc
} from "./handlers/agentIpc.js";

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
  registerSettingsIpc
} from "./handlers/settingsIpc.js";

import {
  registerWindowIpc
} from "./handlers/windowIpc.js";

let registered = false;

export function registerIpcHandlers() {
  if (registered) {
    return;
  }

  registered = true;

  registerAgentIpc();
  registerPetIpc();
  registerInputIpc();
  registerResponseIpc();
  registerSettingIpc();
  registerSettingsIpc();
  registerWindowIpc();
}
