import {
  cloneProviderDefaults
} from "./providerDefaults.js";

export const DEFAULT_SETTINGS = {
  general: {
    launchAtLogin: false,
    rememberPetPosition: true
  },

  pet: {
    scale: 1,
    opacity: 1,
    alwaysOnTop: true,
    showInTaskbar: false,
    shadowOpacity: 0.16,
    position: null
  },

  input: {
    extraWidth: 40,
    gap: 4,
    maxLines: 6,
    fontSize: 14,
    placeholder: "Type a message...",
    backgroundOpacity: 1,
    borderRadius: 10,
    alwaysOnTop: false
  },

  response: {
    gap: 12,
    anchorRatio: 0.16,
    preferredSide: "auto",
    bubbleMaxWidth: 420,
    contentMaxHeight: 240,
    fontSize: 14,
    lineHeight: 1.55,
    backgroundOpacity: 0.97,
    borderRadius: 16,
    alwaysOnTop: true,
    autoCloseSeconds: 0
  },

  appearance: {
    theme: "system",
    accentColor: "#10a37f",
    reducedMotion: false,
    fontFamily: "system",
    customFontFamily: "",
    typography: {
      pet: {
        fontSize: 13,
        lineHeight: 1.4,
        density: "comfortable"
      },
      input: {
        fontSize: 14,
        lineHeight: 1.45,
        density: "comfortable"
      },
      response: {
        fontSize: 14,
        lineHeight: 1.55,
        density: "comfortable"
      },
      conversation: {
        fontSize: 15,
        lineHeight: 1.72,
        density: "comfortable"
      },
      memory: {
        fontSize: 14,
        lineHeight: 1.55,
        density: "comfortable"
      },
      setting: {
        fontSize: 14,
        lineHeight: 1.5,
        density: "comfortable"
      }
    }
  },

  personality: {
    enabled: true,
    name: "Xixi",
    identity: "运行在用户桌面上的轻量 AI 助手",
    language: "auto",
    tone: "natural",
    responseLength: "balanced",
    customInstructions: ""
  },

  conversation: {
    contextTurns: 8,
    maxConversations: 100,
    autoTitle: true,
    saveAbortedReplies: true
  },

  memory: {
    enabled: true,
    maxInjected: 5,
    minPriority: 0.3
  },

  model: {
    activeProvider: "deepseek",
    providers: cloneProviderDefaults()
  }
};

export function cloneDefaultSettings() {
  return structuredClone(
    DEFAULT_SETTINGS
  );
}
