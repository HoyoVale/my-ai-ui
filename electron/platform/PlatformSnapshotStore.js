import fs from "node:fs";
import path from "node:path";

import {
  clone,
  sha256
} from "./canonical.js";

export class PlatformSnapshotStore {
  constructor({ getFilePath, fileSystem = fs } = {}) {
    if (typeof getFilePath !== "function") {
      throw new TypeError("PlatformSnapshotStore requires getFilePath().");
    }
    this.getFilePath = getFilePath;
    this.fileSystem = fileSystem;
  }

  load() {
    try {
      const envelope = JSON.parse(
        this.fileSystem.readFileSync(this.getFilePath(), "utf8")
      );
      if (
        envelope?.version !== 1 ||
        !envelope.state ||
        envelope.checksum !== sha256(envelope.state)
      ) {
        return null;
      }
      return clone(envelope.state);
    } catch {
      return null;
    }
  }

  save(state) {
    const filePath = this.getFilePath();
    const directory = path.dirname(filePath);
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const envelope = {
      version: 1,
      checksum: sha256(state),
      state
    };

    this.fileSystem.mkdirSync(directory, { recursive: true });
    const descriptor = this.fileSystem.openSync(temporary, "wx", 0o600);
    try {
      this.fileSystem.writeFileSync(
        descriptor,
        JSON.stringify(envelope, null, 2),
        "utf8"
      );
      this.fileSystem.fsyncSync(descriptor);
    } finally {
      this.fileSystem.closeSync(descriptor);
    }

    try {
      this.fileSystem.renameSync(temporary, filePath);
    } catch (error) {
      if (!new Set(["EEXIST", "EPERM"]).has(error?.code)) {
        this.fileSystem.rmSync(temporary, { force: true });
        throw error;
      }
      this.fileSystem.rmSync(filePath, { force: true });
      this.fileSystem.renameSync(temporary, filePath);
    }
  }
}
