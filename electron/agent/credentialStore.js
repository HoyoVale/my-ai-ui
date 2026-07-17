import {
  app,
  safeStorage
} from "electron";

import fs from "node:fs";
import path from "node:path";

const CREDENTIAL_FILE =
  "credentials.json";

function getCredentialPath() {
  return path.join(
    app.getPath("userData"),
    CREDENTIAL_FILE
  );
}

function readCredentialRecord() {
  try {
    return JSON.parse(
      fs.readFileSync(
        getCredentialPath(),
        "utf8"
      )
    );
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn(
        "读取模型凭据失败：",
        error
      );
    }

    return null;
  }
}

function writeCredentialRecord(
  record
) {
  const credentialPath =
    getCredentialPath();

  fs.mkdirSync(
    path.dirname(
      credentialPath
    ),
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    credentialPath,
    JSON.stringify(
      record,
      null,
      2
    ),
    {
      encoding: "utf8",
      mode: 0o600
    }
  );
}

function readStoredApiKey() {
  const record =
    readCredentialRecord();

  if (!record?.data) {
    return "";
  }

  try {
    if (
      record.mode ===
      "safe-storage"
    ) {
      if (
        !safeStorage
          .isEncryptionAvailable()
      ) {
        return "";
      }

      return safeStorage.decryptString(
        Buffer.from(
          record.data,
          "base64"
        )
      );
    }

    if (
      record.mode ===
      "plain-text"
    ) {
      return String(
        record.data
      );
    }
  } catch (error) {
    console.warn(
      "解密模型凭据失败：",
      error
    );
  }

  return "";
}

export function getModelApiKey() {
  const stored =
    readStoredApiKey().trim();

  if (stored) {
    return stored;
  }

  return String(
    process.env
      .DEEPSEEK_API_KEY ??
    ""
  ).trim();
}

export function setModelApiKey(
  value
) {
  const apiKey =
    String(value ?? "")
      .trim();

  if (!apiKey) {
    throw new Error(
      "API Key 不能为空。"
    );
  }

  if (
    safeStorage
      .isEncryptionAvailable()
  ) {
    const encrypted =
      safeStorage.encryptString(
        apiKey
      );

    writeCredentialRecord({
      version: 1,
      mode: "safe-storage",
      data:
        encrypted.toString(
          "base64"
        )
    });
  } else {
    /*
     * 极少数 Linux 环境可能没有可用的系统密钥服务。
     * 保留可运行回退，同时在状态中明确标记未受保护。
     */
    writeCredentialRecord({
      version: 1,
      mode: "plain-text",
      data: apiKey
    });
  }

  return getModelCredentialStatus();
}

export function clearModelApiKey() {
  try {
    fs.rmSync(
      getCredentialPath(),
      {
        force: true
      }
    );
  } catch (error) {
    console.warn(
      "删除模型凭据失败：",
      error
    );
  }

  return getModelCredentialStatus();
}

export function getModelCredentialStatus() {
  const record =
    readCredentialRecord();

  if (readStoredApiKey()) {
    return {
      configured: true,
      source: "saved",
      protected:
        record?.mode ===
        "safe-storage"
    };
  }

  if (
    String(
      process.env
        .DEEPSEEK_API_KEY ??
      ""
    ).trim()
  ) {
    return {
      configured: true,
      source: "environment",
      protected: false
    };
  }

  return {
    configured: false,
    source: "none",
    protected: false
  };
}
