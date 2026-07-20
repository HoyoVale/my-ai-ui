import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function sha256Buffer(buffer) {
  return crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");
}

export function sha256Text(value, encoding = "utf8") {
  return sha256Buffer(Buffer.from(String(value ?? ""), encoding));
}

export async function sha256File(filePath, { maxBytes = Infinity } = {}) {
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) {
    const error = new Error("目标路径不是普通文件。");
    error.code = "FILE_REQUIRED";
    throw error;
  }
  if (stat.size > maxBytes) {
    const error = new Error("文件超过允许的哈希校验大小。");
    error.code = "FILE_TOO_LARGE";
    throw error;
  }
  const buffer = await fs.promises.readFile(filePath);
  return {
    sha256: sha256Buffer(buffer),
    bytes: buffer.length,
    modifiedAt: stat.mtimeMs
  };
}

async function syncDirectory(directory) {
  if (process.platform === "win32") {
    return;
  }
  let handle;
  try {
    handle = await fs.promises.open(directory, "r");
    await handle.sync();
  } catch {
    // Some filesystems do not support syncing a directory handle.
  } finally {
    await handle?.close().catch(() => {});
  }
}

function temporaryPath(targetPath, token = "") {
  const explicitToken = String(token ?? "").trim();
  const safeToken = String(explicitToken || crypto.randomUUID())
    .replace(/[^a-zA-Z0-9_-]/gu, "_")
    .slice(0, 80);
  const name = explicitToken
    ? `.${path.basename(targetPath)}.${safeToken}.tmp`
    : `.${path.basename(targetPath)}.${process.pid}.${safeToken}.tmp`;
  return path.join(path.dirname(targetPath), name);
}

export async function atomicWriteTextFile({
  targetPath,
  content,
  encoding = "utf8",
  expectedSha256 = "",
  createDirectories = false,
  mode = 0o644,
  idempotencyKey = "",
  abortSignal = null,
  onBoundary = null
} = {}) {
  const requestedPath = String(targetPath ?? "").trim();
  if (!requestedPath) {
    throw new TypeError("Atomic file write requires targetPath.");
  }
  if (abortSignal?.aborted) {
    const error = new Error("文件写入已取消。");
    error.name = "AbortError";
    error.code = "CANCELLED_BY_USER";
    throw error;
  }

  const buffer = Buffer.from(String(content ?? ""), encoding);
  const desiredSha256 = sha256Buffer(buffer);
  const exists = fs.existsSync(requestedPath);
  let beforeSha256 = "";
  let beforeBytes = 0;
  let existingMode = mode;

  if (exists) {
    const stat = await fs.promises.lstat(requestedPath);
    if (stat.isSymbolicLink()) {
      const error = new Error("拒绝覆盖符号链接。");
      error.code = "SYMLINK_WRITE_BLOCKED";
      throw error;
    }
    if (!stat.isFile()) {
      const error = new Error("目标路径不是普通文件。");
      error.code = "FILE_REQUIRED";
      throw error;
    }
    const current = await fs.promises.readFile(requestedPath);
    beforeSha256 = sha256Buffer(current);
    beforeBytes = current.length;
    existingMode = stat.mode & 0o777;

    if (beforeSha256 === desiredSha256) {
      return {
        changed: false,
        created: false,
        beforeSha256,
        afterSha256: desiredSha256,
        bytes: buffer.length,
        atomic: true,
        idempotentReplay: true
      };
    }
  }

  const normalizedExpected = String(expectedSha256 ?? "").trim().toLowerCase();
  if (normalizedExpected && normalizedExpected !== beforeSha256.toLowerCase()) {
    const error = new Error("目标文件已发生变化，拒绝覆盖。");
    error.code = "FILE_VERSION_CONFLICT";
    error.details = {
      expectedSha256: normalizedExpected,
      actualSha256: beforeSha256
    };
    throw error;
  }

  const directory = path.dirname(requestedPath);
  if (createDirectories) {
    await fs.promises.mkdir(directory, { recursive: true });
  } else {
    const parent = await fs.promises.stat(directory).catch(() => null);
    if (!parent?.isDirectory()) {
      const error = new Error("目标目录不存在。");
      error.code = "DIRECTORY_NOT_FOUND";
      throw error;
    }
  }

  await onBoundary?.("before_temp_write", {
    targetPath: requestedPath,
    desiredSha256,
    beforeSha256
  });

  const temporary = temporaryPath(requestedPath, idempotencyKey);
  let handle;
  let temporaryReady = false;
  try {
    const stale = await fs.promises.lstat(temporary).catch(() => null);
    if (stale) {
      if (stale.isSymbolicLink() || !stale.isFile()) {
        const error = new Error("检测到不安全的临时写入路径。");
        error.code = "UNSAFE_TEMPORARY_PATH";
        throw error;
      }
      const staged = await fs.promises.readFile(temporary);
      if (sha256Buffer(staged) === desiredSha256) {
        temporaryReady = true;
      } else {
        await fs.promises.rm(temporary, { force: true });
      }
    }

    if (!temporaryReady) {
      handle = await fs.promises.open(temporary, "wx", existingMode);
      await handle.writeFile(buffer);
      await handle.sync();
      await handle.close();
      handle = null;
    }

    await onBoundary?.("after_temp_fsync", {
      targetPath: requestedPath,
      temporary,
      desiredSha256,
      recoveredTemporary: temporaryReady
    });

    if (abortSignal?.aborted) {
      const error = new Error("文件写入已取消。");
      error.name = "AbortError";
      error.code = "CANCELLED_BY_USER";
      throw error;
    }

    await fs.promises.rename(temporary, requestedPath);
    await syncDirectory(directory);

    await onBoundary?.("after_atomic_rename", {
      targetPath: requestedPath,
      desiredSha256
    });
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.promises.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }

  const verified = await sha256File(requestedPath);
  if (verified.sha256 !== desiredSha256) {
    const error = new Error("文件写入后的哈希校验失败。");
    error.code = "FILE_WRITE_VERIFY_FAILED";
    error.details = {
      expectedSha256: desiredSha256,
      actualSha256: verified.sha256
    };
    throw error;
  }

  await onBoundary?.("after_hash_verify", {
    targetPath: requestedPath,
    desiredSha256,
    actualSha256: verified.sha256,
    bytes: verified.bytes
  });

  return {
    changed: true,
    created: !exists,
    beforeSha256,
    beforeBytes,
    afterSha256: verified.sha256,
    bytes: verified.bytes,
    atomic: true,
    idempotentReplay: false
  };
}
