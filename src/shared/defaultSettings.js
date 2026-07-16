export const FALLBACK_SETTINGS = {
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
    reducedMotion: false
  },

  personality: {
    enabled: false
  },

  model: {
    provider: "",
    model: ""
  }
};
