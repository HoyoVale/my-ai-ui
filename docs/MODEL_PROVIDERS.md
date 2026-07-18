# Model Provider Architecture

Xixi separates provider connection settings from model-specific settings. A provider owns shared connection and credential data; each provider can contain multiple model configurations, and one model is selected as active.

## Runtime flow

```text
Setting / settings.json
        ↓
resolveActiveModelSettings
        ↓
credentialStore
        ↓
modelFactory.createModelRuntime
        ↓
sdkProviderRegistry
        ↓
AI SDK provider model
        ↓
AgentRuntime (generateText / streamText)
```

The renderer only edits validated configuration. Provider SDK objects and API keys are created and read in the Electron main process.

## Configuration layers

### Provider configuration

A provider stores shared connection information:

- `id`: stable local identifier.
- `type`: adapter type used by the SDK registry.
- `name`: user-facing name.
- `baseURL`: provider API root.
- `credentialMode`: `required`, `optional`, or `none`.
- `environmentKey`: optional environment variable fallback.
- `activeModelId`: selected model inside the provider.
- `models`: model configuration list.

API keys are not written to `settings.json`. They are stored per provider in Electron `userData/credentials.json` and use `safeStorage` when available.

### Model configuration

A model stores request and capacity settings:

- `id`: stable local configuration identifier.
- `name`: user-facing display name.
- `modelId`: provider model identifier.
- `apiMode`: provider endpoint mode when supported.
- `contextTokenBudget`: context-window capacity used by Context inspection.
- `maxOutputTokens`: maximum generated output.
- `temperature`, `topP`, and optional `seed`.
- `maxRetries` and `timeoutMs`.
- reasoning and verbosity options supported by the selected provider.

## SDK adapters

All provider construction is centralized in:

```text
electron/agent/providers/sdkProviderRegistry.js
```

Current mappings:

| Provider type | SDK | Model entry point |
| --- | --- | --- |
| `deepseek` | `@ai-sdk/deepseek` | `provider.chat(modelId)` |
| `openai` | `@ai-sdk/openai` | Responses or Chat |
| `anthropic` | `@ai-sdk/anthropic` | Messages |
| `ollama` | `ollama-ai-provider-v2` | native Ollama chat |
| `openai-compatible` | `@ai-sdk/openai-compatible` | compatible chat model |

The registry returns both the language model and provider-specific request options. `modelFactory` then produces a normalized runtime descriptor for `AgentRuntime`.

## Adding another provider

1. Install an AI SDK provider package compatible with the current `ai` version.
2. Add a provider default in `electron/settings/providerDefaults.js`.
3. Add validation and migration rules in `electron/settings/validateSettings.js`.
4. Register the SDK constructor and option mapper in `sdkProviderRegistry.js`.
5. Add provider-specific controls only when the provider exposes unique options.
6. Add adapter, settings, migration, connection-test, and E2E coverage.

Do not read API keys in renderer code or create provider clients outside the main-process registry.

## Interface boundaries for the next refactor

The stable boundaries are now:

- Settings schema and migration: `electron/settings/`
- Credential storage: `electron/agent/credentialStore.js`
- Active-model resolution: `electron/settings/modelSettings.js`
- Provider SDK construction: `electron/agent/providers/sdkProviderRegistry.js`
- Runtime normalization: `electron/agent/modelFactory.js`
- Request lifecycle: `electron/agent/AgentRuntime.js`
- Model settings UI: `src/Setting/panels/ModelPanel.jsx`

The next structural refactor can move these modules into domain-oriented folders without changing their public responsibilities.
