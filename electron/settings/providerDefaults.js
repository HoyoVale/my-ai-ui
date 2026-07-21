import {
  MODEL_PROVIDER_TEMPLATES
} from "../../src/shared/defaultSettings.js";

// Keep one source of truth for provider templates. Both the renderer fallback
// and the main-process validator consume the same immutable definitions.
export const PROVIDER_DEFAULTS = MODEL_PROVIDER_TEMPLATES;

export function cloneProviderDefaults() {
  return structuredClone(PROVIDER_DEFAULTS);
}
