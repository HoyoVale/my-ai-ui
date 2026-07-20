import {
  app,
  safeStorage
} from "electron";

import fs from "node:fs";
import path from "node:path";

const FILE_NAME = "mcp-credentials.json";
const ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]{0,63}$/u;

function filePath() {
  return path.join(app.getPath("userData"), FILE_NAME);
}

function emptyRecord() {
  return {
    version: 1,
    servers: {}
  };
}

function readRecord() {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(), "utf8"));
    return parsed?.version === 1 && parsed.servers && typeof parsed.servers === "object"
      ? parsed
      : emptyRecord();
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn("读取 MCP 凭据失败：", error);
    }
    return emptyRecord();
  }
}

function writeRecord(record) {
  const target = filePath();
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true });
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

function normalizeServerId(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeEnvName(value) {
  const name = String(value ?? "").trim().toUpperCase();
  return ENV_NAME_PATTERN.test(name) ? name : "";
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
    console.warn("解密 MCP 凭据失败：", error);
  }
  return "";
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

export function setMcpSecret(serverId, envName, value) {
  const id = normalizeServerId(serverId);
  const name = normalizeEnvName(envName);
  const secret = String(value ?? "").trim();
  if (!id || !name || !secret) {
    throw new Error("MCP Server、环境变量名和凭据均不能为空。");
  }

  const record = readRecord();
  record.servers[id] = record.servers[id] ?? {};
  record.servers[id][name] = encryptedEntry(secret);
  writeRecord(record);
  return getMcpSecretStatus(id, name);
}

export function clearMcpSecret(serverId, envName) {
  const id = normalizeServerId(serverId);
  const name = normalizeEnvName(envName);
  const record = readRecord();
  if (record.servers[id]) {
    delete record.servers[id][name];
    if (Object.keys(record.servers[id]).length === 0) {
      delete record.servers[id];
    }
  }
  if (Object.keys(record.servers).length === 0) {
    fs.rmSync(filePath(), { force: true });
  } else {
    writeRecord(record);
  }
  return getMcpSecretStatus(id, name);
}

export function getMcpSecretStatus(serverId, envName) {
  const id = normalizeServerId(serverId);
  const name = normalizeEnvName(envName);
  const entry = readRecord().servers[id]?.[name];
  const stored = Boolean(decrypt(entry).trim());
  const environment = Boolean(String(process.env[name] ?? "").trim());
  return {
    serverId: id,
    envName: name,
    configured: stored || environment,
    source: stored ? "saved" : environment ? "environment" : "none",
    protected: stored && entry?.mode === "safe-storage"
  };
}

export function getMcpServerSecretEnvironment(server = {}) {
  const id = normalizeServerId(server.id);
  const record = readRecord();
  const output = {};
  for (const rawName of server.secretEnvKeys ?? []) {
    const name = normalizeEnvName(rawName);
    if (!name) {
      continue;
    }
    const stored = decrypt(record.servers[id]?.[name]).trim();
    const environment = String(process.env[name] ?? "").trim();
    const value = stored || environment;
    if (value) {
      output[name] = value;
    }
  }
  return output;
}

export function listMcpSecretStatuses(server = {}) {
  return (server.secretEnvKeys ?? []).map((name) =>
    getMcpSecretStatus(server.id, name)
  );
}
