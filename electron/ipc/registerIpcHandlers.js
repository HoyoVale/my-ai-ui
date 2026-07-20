import {
  registerAgentIpc
} from "./handlers/agentIpc.js";

import {
  registerConversationIpc
} from "./handlers/conversationIpc.js";

import {
  registerInputIpc
} from "./handlers/inputIpc.js";

import {
  registerMemoryIpc
} from "./handlers/memoryIpc.js";

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
  registerSecurityIpc
} from "./handlers/securityIpc.js";

import {
  registerWindowIpc
} from "./handlers/windowIpc.js";

import {
  registerWorkspaceIpc
} from "./handlers/workspaceIpc.js";

import {
  registerToolIpc
} from "./handlers/toolIpc.js";

let registered = false;

export function registerIpcHandlers() {
  if (registered) {
    return;
  }

  registered = true;

  registerAgentIpc();
  registerConversationIpc();
  registerPetIpc();
  registerInputIpc();
  registerMemoryIpc();
  registerResponseIpc();
  registerSettingIpc();
  registerSettingsIpc();
  registerToolIpc();
  registerWorkspaceIpc();
  registerSecurityIpc();
  registerWindowIpc();
}
