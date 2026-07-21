import fs from "node:fs";
import path from "node:path";

const REPLACE_ERRORS = new Set([
  "EEXIST",
  "EPERM",
  "ENOTEMPTY"
]);

function temporaryPath(target) {
  return `${target}.${process.pid}.${Date.now()}.tmp`;
}

function backupPath(target) {
  return `${target}.bak`;
}

function exists(fileSystem, target) {
  try {
    return fileSystem.existsSync(target);
  } catch {
    return false;
  }
}

export function recoverAtomicSettingsFile(
  target,
  { fileSystem = fs } = {}
) {
  const backup = backupPath(target);
  const targetExists = exists(fileSystem, target);
  const backupExists = exists(fileSystem, backup);

  if (!targetExists && backupExists) {
    fileSystem.renameSync(backup, target);
    return { recovered: true };
  }

  if (targetExists && backupExists) {
    fileSystem.rmSync(backup, { force: true });
  }

  return { recovered: false };
}

export function writeSettingsJsonAtomic(
  target,
  value,
  { fileSystem = fs } = {}
) {
  const directory = path.dirname(target);
  const temporary = temporaryPath(target);
  const backup = backupPath(target);
  const content = JSON.stringify(value, null, 2);

  fileSystem.mkdirSync(directory, { recursive: true });
  recoverAtomicSettingsFile(target, { fileSystem });
  fileSystem.writeFileSync(temporary, content, "utf8");

  try {
    fileSystem.renameSync(temporary, target);
    return;
  } catch (error) {
    if (!REPLACE_ERRORS.has(error?.code)) {
      fileSystem.rmSync(temporary, { force: true });
      throw error;
    }
  }

  const hadTarget = exists(fileSystem, target);

  try {
    fileSystem.rmSync(backup, { force: true });
    if (hadTarget) {
      fileSystem.renameSync(target, backup);
    }
    fileSystem.renameSync(temporary, target);
    fileSystem.rmSync(backup, { force: true });
  } catch (error) {
    fileSystem.rmSync(temporary, { force: true });

    if (
      hadTarget &&
      !exists(fileSystem, target) &&
      exists(fileSystem, backup)
    ) {
      try {
        fileSystem.renameSync(backup, target);
      } catch (restoreError) {
        error.restoreError = restoreError;
      }
    }

    throw error;
  }
}
