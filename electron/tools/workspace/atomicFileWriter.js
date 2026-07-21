import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function sha256Buffer(buffer) {
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
  if (process.platform === "win32") return;
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

function safeToken(value = "") {
  return String(value || crypto.randomUUID())
    .replace(/[^a-zA-Z0-9_-]/gu, "_")
    .slice(0, 80);
}

function transactionPath(targetPath, token, suffix) {
  return path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${safeToken(token)}.${suffix}`
  );
}

function temporaryPath(targetPath, token = "") {
  const explicitToken = String(token ?? "").trim();
  const name = explicitToken
    ? `.${path.basename(targetPath)}.${safeToken(explicitToken)}.tmp`
    : `.${path.basename(targetPath)}.${process.pid}.${safeToken()}.tmp`;
  return path.join(path.dirname(targetPath), name);
}

function abortError() {
  const error = new Error("文件写入已取消。");
  error.name = "AbortError";
  error.code = "CANCELLED_BY_USER";
  return error;
}

async function inspectExistingFile(targetPath, mode) {
  const stat = await fs.promises.lstat(targetPath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) {
    return {
      exists: false,
      buffer: null,
      sha256: "",
      bytes: 0,
      mode
    };
  }
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
  const buffer = await fs.promises.readFile(targetPath);
  return {
    exists: true,
    buffer,
    sha256: sha256Buffer(buffer),
    bytes: buffer.length,
    mode: stat.mode & 0o777
  };
}

async function stageBuffer({ targetPath, buffer, mode, token, abortSignal }) {
  if (abortSignal?.aborted) throw abortError();
  const temporary = temporaryPath(targetPath, token);
  let handle;
  const stale = await fs.promises.lstat(temporary).catch(() => null);
  if (stale) {
    if (stale.isSymbolicLink() || !stale.isFile()) {
      const error = new Error("检测到不安全的临时写入路径。");
      error.code = "UNSAFE_TEMPORARY_PATH";
      throw error;
    }
    const staged = await fs.promises.readFile(temporary);
    if (sha256Buffer(staged) === sha256Buffer(buffer)) {
      return { temporary, recovered: true };
    }
    await fs.promises.rm(temporary, { force: true });
  }
  try {
    handle = await fs.promises.open(temporary, "wx", mode);
    await handle.writeFile(buffer);
    await handle.sync();
  } finally {
    await handle?.close().catch(() => {});
  }
  return { temporary, recovered: false };
}

async function restoreBuffer({ targetPath, buffer, mode, token }) {
  if (!buffer) {
    await fs.promises.rm(targetPath, { force: true });
    return;
  }
  const temporary = transactionPath(targetPath, `${token}-rollback`, "tmp");
  await fs.promises.rm(temporary, { force: true }).catch(() => {});
  const handle = await fs.promises.open(temporary, "wx", mode);
  try {
    await handle.writeFile(buffer);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.promises.rename(temporary, targetPath);
  await syncDirectory(path.dirname(targetPath));
}

export async function atomicWriteFileBuffer({
  targetPath,
  buffer,
  expectedSha256 = "",
  createDirectories = false,
  createOnly = false,
  overwrite = true,
  mode = 0o644,
  idempotencyKey = "",
  abortSignal = null,
  onBoundary = null
} = {}) {
  const requestedPath = String(targetPath ?? "").trim();
  if (!requestedPath) throw new TypeError("Atomic file write requires targetPath.");
  if (abortSignal?.aborted) throw abortError();
  const desiredBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? "");
  const desiredSha256 = sha256Buffer(desiredBuffer);
  const existing = await inspectExistingFile(requestedPath, mode);

  if (createOnly && existing.exists) {
    const error = new Error("目标文件已存在，createOnly 写入被拒绝。");
    error.code = "FILE_EXISTS";
    throw error;
  }
  if (!overwrite && existing.exists) {
    const error = new Error("目标文件已存在，overwrite=false 时拒绝覆盖。");
    error.code = "FILE_EXISTS";
    throw error;
  }
  if (existing.exists && existing.sha256 === desiredSha256) {
    return {
      changed: false,
      created: false,
      beforeSha256: existing.sha256,
      beforeBytes: existing.bytes,
      afterSha256: desiredSha256,
      bytes: desiredBuffer.length,
      atomic: true,
      idempotentReplay: true,
      rollbackPerformed: false
    };
  }

  const normalizedExpected = String(expectedSha256 ?? "").trim().toLowerCase();
  if (normalizedExpected && normalizedExpected !== existing.sha256.toLowerCase()) {
    const error = new Error("目标文件已发生变化，拒绝覆盖。");
    error.code = "FILE_VERSION_CONFLICT";
    error.details = {
      expectedSha256: normalizedExpected,
      actualSha256: existing.sha256
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
    beforeSha256: existing.sha256
  });

  const staged = await stageBuffer({
    targetPath: requestedPath,
    buffer: desiredBuffer,
    mode: existing.mode,
    token: idempotencyKey,
    abortSignal
  });
  let renamed = false;
  let rollbackPerformed = false;
  try {
    await onBoundary?.("after_temp_fsync", {
      targetPath: requestedPath,
      temporary: staged.temporary,
      desiredSha256,
      recoveredTemporary: staged.recovered
    });
    if (abortSignal?.aborted) throw abortError();
    await fs.promises.rename(staged.temporary, requestedPath);
    renamed = true;
    await syncDirectory(directory);
    await onBoundary?.("after_atomic_rename", {
      targetPath: requestedPath,
      desiredSha256
    });

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
      created: !existing.exists,
      beforeSha256: existing.sha256,
      beforeBytes: existing.bytes,
      afterSha256: verified.sha256,
      bytes: verified.bytes,
      atomic: true,
      idempotentReplay: false,
      rollbackPerformed
    };
  } catch (error) {
    await fs.promises.rm(staged.temporary, { force: true }).catch(() => {});
    if (renamed) {
      try {
        await restoreBuffer({
          targetPath: requestedPath,
          buffer: existing.buffer,
          mode: existing.mode,
          token: idempotencyKey || crypto.randomUUID()
        });
        rollbackPerformed = true;
        error.details = {
          ...(error.details ?? {}),
          rollbackPerformed: true
        };
      } catch (rollbackError) {
        error.details = {
          ...(error.details ?? {}),
          rollbackPerformed: false,
          rollbackError: rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError)
        };
      }
    }
    throw error;
  }
}

export async function atomicWriteTextFile({
  targetPath,
  content,
  encoding = "utf8",
  expectedSha256 = "",
  createDirectories = false,
  createOnly = false,
  overwrite = true,
  mode = 0o644,
  idempotencyKey = "",
  abortSignal = null,
  onBoundary = null
} = {}) {
  return atomicWriteFileBuffer({
    targetPath,
    buffer: Buffer.from(String(content ?? ""), encoding),
    expectedSha256,
    createDirectories,
    createOnly,
    overwrite,
    mode,
    idempotencyKey,
    abortSignal,
    onBoundary
  });
}

export async function atomicWriteFileTransaction({
  entries = [],
  idempotencyKey = "",
  abortSignal = null,
  onBoundary = null
} = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new TypeError("Atomic file transaction requires entries.");
  }
  if (abortSignal?.aborted) throw abortError();
  const token = safeToken(idempotencyKey || crypto.randomUUID());
  const prepared = [];
  const committed = [];
  let rollbackPerformed = false;

  try {
    for (const entry of entries) {
      const targetPath = String(entry.targetPath ?? "").trim();
      if (!targetPath) throw new TypeError("Transaction entry requires targetPath.");
      const buffer = Buffer.isBuffer(entry.buffer) ? entry.buffer : Buffer.from(entry.buffer ?? "");
      const existing = await inspectExistingFile(targetPath, entry.mode ?? 0o644);
      const expected = String(entry.expectedSha256 ?? "").trim().toLowerCase();
      if (expected && expected !== existing.sha256.toLowerCase()) {
        const error = new Error(`文件 ${path.basename(targetPath)} 已发生变化，补丁事务被拒绝。`);
        error.code = "FILE_VERSION_CONFLICT";
        error.details = { targetPath, expectedSha256: expected, actualSha256: existing.sha256 };
        throw error;
      }
      if (entry.createOnly && existing.exists) {
        const error = new Error(`文件 ${path.basename(targetPath)} 已存在，无法按创建操作应用补丁。`);
        error.code = "FILE_EXISTS";
        throw error;
      }
      const directory = path.dirname(targetPath);
      if (entry.createDirectories === true) {
        await fs.promises.mkdir(directory, { recursive: true });
      } else {
        const parent = await fs.promises.stat(directory).catch(() => null);
        if (!parent?.isDirectory()) {
          const error = new Error("目标目录不存在。");
          error.code = "DIRECTORY_NOT_FOUND";
          throw error;
        }
      }
      const staged = await stageBuffer({
        targetPath,
        buffer,
        mode: existing.mode,
        token: `${token}-${prepared.length}`,
        abortSignal
      });
      prepared.push({
        ...entry,
        targetPath,
        buffer,
        existing,
        temporary: staged.temporary,
        backup: transactionPath(targetPath, `${token}-${prepared.length}`, "bak"),
        desiredSha256: sha256Buffer(buffer)
      });
    }

    for (const item of prepared) {
      const backupStat = await fs.promises.lstat(item.backup).catch((backupError) => {
        if (backupError?.code === "ENOENT") return null;
        throw backupError;
      });
      if (backupStat) {
        const error = new Error(
          `检测到文件 ${path.basename(item.targetPath)} 的未完成事务备份，拒绝覆盖恢复证据。`
        );
        error.code = "WRITE_TRANSACTION_RECOVERY_REQUIRED";
        error.details = {
          targetPath: item.targetPath,
          backupPath: item.backup,
          backupType: backupStat.isSymbolicLink()
            ? "symlink"
            : backupStat.isFile()
              ? "file"
              : "other"
        };
        throw error;
      }
    }

    await onBoundary?.("transaction_staged", {
      files: prepared.map((item) => item.targetPath)
    });
    if (abortSignal?.aborted) throw abortError();

    for (const item of prepared) {
      if (item.existing.exists) {
        await fs.promises.rename(item.targetPath, item.backup);
      }
      try {
        await fs.promises.rename(item.temporary, item.targetPath);
      } catch (error) {
        if (item.existing.exists) {
          await fs.promises.rename(item.backup, item.targetPath).catch(() => {});
        }
        throw error;
      }
      committed.push(item);
      await onBoundary?.("transaction_file_committed", {
        targetPath: item.targetPath,
        desiredSha256: item.desiredSha256
      });
    }

    for (const item of committed) {
      const verified = await sha256File(item.targetPath);
      if (verified.sha256 !== item.desiredSha256) {
        const error = new Error(`文件 ${path.basename(item.targetPath)} 的事务后哈希校验失败。`);
        error.code = "FILE_WRITE_VERIFY_FAILED";
        error.details = {
          targetPath: item.targetPath,
          expectedSha256: item.desiredSha256,
          actualSha256: verified.sha256
        };
        throw error;
      }
    }

    for (const item of committed) {
      await syncDirectory(path.dirname(item.targetPath));
      await fs.promises.rm(item.backup, { force: true }).catch(() => {});
    }
    await onBoundary?.("transaction_verified", {
      files: committed.map((item) => item.targetPath)
    });
    return {
      changed: true,
      atomic: true,
      rollbackPerformed,
      files: committed.map((item) => ({
        targetPath: item.targetPath,
        created: !item.existing.exists,
        beforeSha256: item.existing.sha256,
        beforeBytes: item.existing.bytes,
        afterSha256: item.desiredSha256,
        afterBytes: item.buffer.length
      }))
    };
  } catch (error) {
    for (const item of [...committed].reverse()) {
      try {
        await fs.promises.rm(item.targetPath, { force: true });
        if (item.existing.exists && fs.existsSync(item.backup)) {
          await fs.promises.rename(item.backup, item.targetPath);
        }
        await syncDirectory(path.dirname(item.targetPath));
        rollbackPerformed = true;
      } catch (rollbackError) {
        error.details = {
          ...(error.details ?? {}),
          rollbackError: rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError)
        };
      }
    }
    for (const item of prepared) {
      await fs.promises.rm(item.temporary, { force: true }).catch(() => {});
    }
    error.details = {
      ...(error.details ?? {}),
      rollbackPerformed
    };
    throw error;
  }
}
