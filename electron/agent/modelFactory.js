import {
  createDeepSeek
} from "@ai-sdk/deepseek";

import {
  getModelApiKey
} from "./credentialStore.js";

export function createConfiguredModel(
  modelSettings
) {
  const apiKey =
    getModelApiKey();

  if (!apiKey) {
    throw new Error(
      "尚未配置 DeepSeek API Key。请先在 Setting → Model 中保存密钥。"
    );
  }

  if (
    modelSettings.provider !==
    "deepseek"
  ) {
    throw new Error(
      `暂不支持模型供应商：${modelSettings.provider}`
    );
  }

  const provider =
    createDeepSeek({
      apiKey,
      baseURL:
        modelSettings.baseURL
    });

  return provider(
    modelSettings.model
  );
}
