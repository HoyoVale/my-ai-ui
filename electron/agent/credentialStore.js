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

function normalizeRecord(source) {
  if (
    source?.version === 2 &&
    source.credentials &&
    typeof source.credentials ===
      "object"
  ) {
    return source;
  }

  if (source?.data) {
    return {
      version: 2,
      credentials: {
        deepseek: {
          mode:
            source.mode ??
            "plain-text",
          data: source.data
        }
      }
    };
  }

  return {
    version: 2,
    credentials: {}
  };
}

function readCredentialRecord() {
  try {
    return normalizeRecord(
      JSON.parse(
        fs.readFileSync(
          getCredentialPath(),
          "utf8"
        )
      )
    );
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn(
        "读取模型凭据失败：",
        error
      );
    }

    return normalizeRecord(null);
  }
}

function writeCredentialRecord(record) {
  const credentialPath =
    getCredentialPath();

  fs.mkdirSync(
    path.dirname(credentialPath),
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    credentialPath,
    JSON.stringify(
      normalizeRecord(record),
      null,
      2
    ),
    {
      encoding: "utf8",
      mode: 0o600
    }
  );
}

function decryptEntry(entry) {
  if (!entry?.data) {
    return "";
  }

  try {
    if (entry.mode === "safe-storage") {
      if (
        !safeStorage
          .isEncryptionAvailable()
      ) {
        return "";
      }

      return safeStorage.decryptString(
        Buffer.from(
          entry.data,
          "base64"
        )
      );
    }

    if (entry.mode === "plain-text") {
      return String(entry.data);
    }
  } catch (error) {
    console.warn(
      "解密模型凭据失败：",
      error
    );
  }

  return "";
}

function readStoredApiKey(providerId) {
  const record =
    readCredentialRecord();

  return decryptEntry(
    record.credentials[
      String(providerId ?? "")
    ]
  ).trim();
}

function readEnvironmentApiKey(
  environmentKey
) {
  const key = String(
    environmentKey ?? ""
  )
    .trim()
    .replace(/[^A-Z0-9_]/gi, "")
    .toUpperCase();

  if (!key) {
    return "";
  }

  return String(
    process.env[key] ?? ""
  ).trim();
}

export function getProviderApiKey({
  providerId,
  environmentKey
} = {}) {
  return (
    readStoredApiKey(providerId) ||
    readEnvironmentApiKey(
      environmentKey
    )
  );
}

export function setProviderApiKey(
  providerId,
  value,
  environmentKey = ""
) {
  const normalizedProviderId =
    String(providerId ?? "")
      .trim();

  const apiKey = String(value ?? "")
    .trim();

  if (!normalizedProviderId) {
    throw new Error(
      "提供商 ID 不能为空。"
    );
  }

  if (!apiKey) {
    throw new Error(
      "API Key 不能为空。"
    );
  }

  const record =
    readCredentialRecord();

  if (
    safeStorage
      .isEncryptionAvailable()
  ) {
    const encrypted =
      safeStorage.encryptString(apiKey);

    record.credentials[
      normalizedProviderId
    ] = {
      mode: "safe-storage",
      data: encrypted.toString(
        "base64"
      )
    };
  } else {
    record.credentials[
      normalizedProviderId
    ] = {
      mode: "plain-text",
      data: apiKey
    };
  }

  writeCredentialRecord(record);

  return getProviderCredentialStatus({
    providerId:
      normalizedProviderId,
    environmentKey
  });
}

export function clearProviderApiKey(
  providerId,
  environmentKey = ""
) {
  const normalizedProviderId =
    String(providerId ?? "")
      .trim();

  const record =
    readCredentialRecord();

  delete record.credentials[
    normalizedProviderId
  ];

  if (
    Object.keys(
      record.credentials
    ).length === 0
  ) {
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
  } else {
    writeCredentialRecord(record);
  }

  return getProviderCredentialStatus({
    providerId:
      normalizedProviderId,
    environmentKey
  });
}

export function getProviderCredentialStatus({
  providerId,
  environmentKey
} = {}) {
  const normalizedProviderId =
    String(providerId ?? "")
      .trim();

  const record =
    readCredentialRecord();

  const entry =
    record.credentials[
      normalizedProviderId
    ];

  if (decryptEntry(entry).trim()) {
    return {
      providerId:
        normalizedProviderId,
      configured: true,
      source: "saved",
      protected:
        entry?.mode ===
        "safe-storage"
    };
  }

  if (
    readEnvironmentApiKey(
      environmentKey
    )
  ) {
    return {
      providerId:
        normalizedProviderId,
      configured: true,
      source: "environment",
      protected: false,
      environmentKey:
        String(
          environmentKey ?? ""
        )
    };
  }

  return {
    providerId:
      normalizedProviderId,
    configured: false,
    source: "none",
    protected: false,
    environmentKey:
      String(
        environmentKey ?? ""
      )
  };
}

/* Backward-compatible helpers for older callers. */
export function getModelApiKey() {
  return getProviderApiKey({
    providerId: "deepseek",
    environmentKey:
      "DEEPSEEK_API_KEY"
  });
}

export function setModelApiKey(value) {
  return setProviderApiKey(
    "deepseek",
    value,
    "DEEPSEEK_API_KEY"
  );
}

export function clearModelApiKey() {
  return clearProviderApiKey(
    "deepseek",
    "DEEPSEEK_API_KEY"
  );
}

export function getModelCredentialStatus() {
  return getProviderCredentialStatus({
    providerId: "deepseek",
    environmentKey:
      "DEEPSEEK_API_KEY"
  });
}
