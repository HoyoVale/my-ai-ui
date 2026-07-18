import {
  getProviderApiKey
} from "./credentialStore.js";

import {
  buildSdkRequestOptions,
  createSdkModel
} from "./providers/sdkProviderRegistry.js";

function getCredential(
  modelSettings
) {
  return getProviderApiKey({
    providerId:
      modelSettings.providerId,
    environmentKey:
      modelSettings.environmentKey
  });
}

export function getCredentialError(
  modelSettings
) {
  if (
    modelSettings.credentialMode !==
      "required"
  ) {
    return null;
  }

  if (getCredential(modelSettings)) {
    return null;
  }

  return `尚未配置 ${modelSettings.providerName} API Key。请先在 Setting → Model 中保存密钥。`;
}

export function createModelRuntime(
  modelSettings
) {
  const apiKey =
    getCredential(modelSettings);

  const credentialError =
    getCredentialError(
      modelSettings
    );

  if (credentialError) {
    throw new Error(
      credentialError
    );
  }

  const sdkModel = createSdkModel({
    modelSettings,
    apiKey
  });

  return {
    model: sdkModel.model,
    requestOptions:
      buildSdkRequestOptions(
        modelSettings,
        sdkModel.providerOptions
      ),
    descriptor: {
      providerId:
        modelSettings.providerId,
      providerName:
        modelSettings.providerName,
      providerType:
        modelSettings.provider,
      modelConfigId:
        modelSettings.modelConfigId,
      modelId:
        modelSettings.model,
      modelName:
        modelSettings.modelName,
      sdk: sdkModel.sdk,
      apiMode: sdkModel.apiMode,
      reasoningEnabled:
        sdkModel.reasoningEnabled
    }
  };
}

export function createConfiguredModel(
  modelSettings
) {
  return createModelRuntime(
    modelSettings
  ).model;
}
