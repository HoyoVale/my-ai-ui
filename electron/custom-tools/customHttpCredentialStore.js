import electron from "electron";

const {
  app,
  safeStorage
} = electron;

import fs from "node:fs";
import path from "node:path";

const FILE_NAME = "custom-http-credentials.json";

function filePath() {
  return path.join(app.getPath("userData"), FILE_NAME);
}

function emptyRecord() {
  return {
    version: 1,
    tools: {}
  };
}

function normalizeToolId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 40);
}

function readRecord() {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(), "utf8"));
    if (
      parsed?.version === 1 &&
      parsed.tools &&
      typeof parsed.tools === "object"
    ) {
      return parsed;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn("读取自定义 HTTP 工具凭据失败：", error);
    }
  }
  return emptyRecord();
}

function writeRecord(record) {
  const target = filePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(record, null, 2), {
    encoding: "utf8",
    mode: 0o600
  });
  try {
    fs.renameSync(temp, target);
  } catch (error) {
    if (!["EEXIST", "EPERM", "ENOTEMPTY"].includes(error?.code)) {
      fs.rmSync(temp, { force: true });
      throw error;
    }
    fs.rmSync(target, { force: true });
    fs.renameSync(temp, target);
  }
}

function encryptedEntry(value) {
  if (safeStorage.isEncryptionAvailable()) {
    return {
      mode: "safe-storage",
      data: safeStorage.encryptString(value).toString("base64")
    };
  }
  return {
    mode: "plain-text",
    data: value
  };
}

function decrypt(entry) {
  if (!entry?.data) {
    return "";
  }
  try {
    if (entry.mode === "safe-storage") {
      if (!safeStorage.isEncryptionAvailable()) {
        return "";
      }
      return safeStorage.decryptString(Buffer.from(entry.data, "base64"));
    }
    if (entry.mode === "plain-text") {
      return String(entry.data);
    }
  } catch (error) {
    console.warn("解密自定义 HTTP 工具凭据失败：", error);
  }
  return "";
}

export function setCustomHttpSecret(toolId, value) {
  const id = normalizeToolId(toolId);
  const secret = String(value ?? "").trim();
  if (!id || !secret) {
    throw new Error("工具 ID 和凭据均不能为空。");
  }
  const record = readRecord();
  record.tools[id] = encryptedEntry(secret);
  writeRecord(record);
  return getCustomHttpSecretStatus(id);
}

export function clearCustomHttpSecret(toolId) {
  const id = normalizeToolId(toolId);
  const record = readRecord();
  delete record.tools[id];
  if (Object.keys(record.tools).length === 0) {
    fs.rmSync(filePath(), { force: true });
  } else {
    writeRecord(record);
  }
  return getCustomHttpSecretStatus(id);
}

export function getCustomHttpSecret(toolId) {
  const id = normalizeToolId(toolId);
  if (!id) {
    return "";
  }
  return decrypt(readRecord().tools[id]).trim();
}

export function getCustomHttpSecretStatus(toolId) {
  const id = normalizeToolId(toolId);
  const entry = readRecord().tools[id];
  const configured = Boolean(decrypt(entry).trim());
  return {
    toolId: id,
    configured,
    protected: configured && entry?.mode === "safe-storage"
  };
}

export function clearAllCustomHttpSecrets() {
  fs.rmSync(filePath(), { force: true });
}
