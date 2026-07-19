import fs from "node:fs";
import path from "node:path";

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

  load() {
    if (!this.filePath || !fs.existsSync(this.filePath)) {
      return null;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (!parsed || typeof parsed !== "object" || !this.isOwned(parsed)) {
        return null;
      }
      return clone(parsed);
    } catch {
      return null;
    }
  }

  async store(checkpoint) {
    if (!checkpoint || typeof checkpoint !== "object") {
      throw new TypeError("Runtime checkpoint must be an object.");
    }

    const value = {
      ...clone(checkpoint),
      taskId: String(checkpoint.taskId ?? this.taskId),
      workspaceId: String(checkpoint.workspaceId ?? this.workspaceId),
      persistedAt: Date.now()
    };

    if (!this.isOwned(value)) {
      throw new Error("Runtime checkpoint owner does not match the store.");
    }

    if (this.filePath) {
      await atomicWriteJson(this.filePath, value);
    }
    return clone(value);
  }
}
