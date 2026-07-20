import fs from "node:fs";
import path from "node:path";

import {
  migrateRuntimeCheckpoint,
  verifyRuntimeCheckpoint
} from "./RuntimeCheckpointSchema.js";

function clone(value) {
  return structuredClone(value);
}

async function atomicWriteJson(filePath, value) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const handle = await fs.promises.open(temporary, "wx");

  try {
    await handle.writeFile(JSON.stringify(value), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await fs.promises.rename(temporary, filePath);
  } catch (error) {
    if (!["EEXIST", "EPERM"].includes(error?.code)) {
      await fs.promises.rm(temporary, { force: true });
      throw error;
    }
    await fs.promises.rm(filePath, { force: true });
    await fs.promises.rename(temporary, filePath);
  }
}

export class RuntimeCheckpointStore {
  constructor({
    directory = "",
    taskId = "",
    workspaceId = ""
  } = {}) {
    this.directory = String(directory ?? "").trim();
    this.taskId = String(taskId ?? "");
    this.workspaceId = String(workspaceId ?? "");
    this.filePath = this.directory
      ? path.join(this.directory, "checkpoint.json")
      : "";
  }

  isOwned(value) {
    return (
      (!this.taskId || value?.taskId === this.taskId) &&
      (!this.workspaceId || value?.workspaceId === this.workspaceId)
    );
  }

  loadDetailed() {
    if (!this.filePath || !fs.existsSync(this.filePath)) {
      return {
        status: "missing",
        checkpoint: null,
        sourceVersion: 0
      };
    }

    let source;
    try {
      source = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch (error) {
      return {
        status: "corrupt",
        checkpoint: null,
        sourceVersion: 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }

    if (!source || typeof source !== "object") {
      return {
        status: "corrupt",
        checkpoint: null,
        sourceVersion: 0,
        error: "Checkpoint is not an object."
      };
    }

    if (!this.isOwned(source)) {
      return {
        status: "owner_mismatch",
        checkpoint: null,
        sourceVersion: Number(source.version) || 0
      };
    }

    if (!verifyRuntimeCheckpoint(source)) {
      return {
        status: "corrupt",
        checkpoint: null,
        sourceVersion: Number(source.version) || 0,
        error: "Checkpoint checksum verification failed."
      };
    }

    const checkpoint = migrateRuntimeCheckpoint(source);
    if (!checkpoint) {
      return {
        status: "corrupt",
        checkpoint: null,
        sourceVersion: Number(source.version) || 0,
        error: "Checkpoint migration failed."
      };
    }

    return {
      status: Number(source.version) < Number(checkpoint.version)
        ? "migrated"
        : "valid",
      checkpoint: clone(checkpoint),
      sourceVersion: Number(source.version) || 0
    };
  }

  load() {
    return this.loadDetailed().checkpoint;
  }

  async quarantine(reason = "corrupt") {
    if (!this.filePath || !fs.existsSync(this.filePath)) {
      return "";
    }

    const quarantined = path.join(
      path.dirname(this.filePath),
      `checkpoint.${String(reason).replace(/[^a-z0-9_-]/gi, "_")}.${Date.now()}.json`
    );
    await fs.promises.rename(this.filePath, quarantined);
    return quarantined;
  }

  async store(checkpoint) {
    if (!checkpoint || typeof checkpoint !== "object") {
      throw new TypeError("Runtime checkpoint must be an object.");
    }

    const migrated = migrateRuntimeCheckpoint({
      ...clone(checkpoint),
      taskId: String(checkpoint.taskId ?? this.taskId),
      workspaceId: String(checkpoint.workspaceId ?? this.workspaceId),
      persistedAt: Date.now()
    }, { verify: false });

    if (!migrated) {
      throw new Error("Runtime checkpoint could not be normalized.");
    }

    if (!this.isOwned(migrated)) {
      throw new Error("Runtime checkpoint owner does not match the store.");
    }

    if (this.filePath) {
      await atomicWriteJson(this.filePath, migrated);
    }
    return clone(migrated);
  }
}
