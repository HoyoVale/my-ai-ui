import fs from "node:fs";
import path from "node:path";

import {
  createEmptyMemoryData,
  sanitizeMemoryData
} from "./memorySchema.js";

function clone(value) {
  return structuredClone(value);
}

function isLegacyData(source) {
  if (
    !source ||
    typeof source !== "object"
  ) {
    return false;
  }

  if (source.version !== 3) {
    return true;
  }

  return Array.isArray(
    source.memories
  ) &&
    source.memories.some(
      (memory) =>
        memory &&
        typeof memory ===
          "object" &&
        (
          "category" in memory ||
          "importance" in memory ||
          "scope" in memory
        )
    );
}

export class MemoryStore {
  constructor({
    getFilePath,
    fileSystem = fs
  }) {
    if (
      typeof getFilePath !==
      "function"
    ) {
      throw new TypeError(
        "MemoryStore requires getFilePath()."
      );
    }

    this.getFilePath =
      getFilePath;
    this.fileSystem =
      fileSystem;
    this.cache = null;
  }

  getPath() {
    return this.getFilePath();
  }

  getLegacyBackupPath(
    version
  ) {
    const filePath =
      this.getPath();

    const extension =
      path.extname(filePath);

    const baseName =
      path.basename(
        filePath,
        extension
      );

    const versionLabel =
      Number.isFinite(
        Number(version)
      )
        ? `v${Number(version)}`
        : "pre-v3";

    return path.join(
      path.dirname(filePath),
      `${baseName}.${versionLabel}.backup${extension || ".json"}`
    );
  }

  load() {
    if (this.cache) {
      return clone(this.cache);
    }

    const filePath =
      this.getPath();

    try {
      const text =
        this.fileSystem
          .readFileSync(
            filePath,
            "utf8"
          );

      const source =
        JSON.parse(text);

      if (isLegacyData(source)) {
        this.backupLegacyFile(
          text,
          source?.version
        );
      }

      this.cache =
        sanitizeMemoryData(
          source
        );
    } catch (error) {
      if (
        error?.code !== "ENOENT"
      ) {
        console.warn(
          "读取记忆文件失败，将创建新文件：",
          error
        );
      }

      this.cache =
        createEmptyMemoryData();
    }

    this.write(this.cache);

    return clone(this.cache);
  }

  save(data) {
    this.cache =
      sanitizeMemoryData(data);

    this.write(this.cache);

    return clone(this.cache);
  }

  clearCache() {
    this.cache = null;
  }

  backupLegacyFile(
    text,
    version
  ) {
    const backupPath =
      this.getLegacyBackupPath(
        version
      );

    try {
      this.fileSystem.mkdirSync(
        path.dirname(
          backupPath
        ),
        {
          recursive: true
        }
      );

      this.fileSystem.writeFileSync(
        backupPath,
        text,
        {
          encoding: "utf8",
          flag: "wx"
        }
      );
    } catch (error) {
      if (
        error?.code !== "EEXIST"
      ) {
        console.warn(
          "备份旧版记忆文件失败：",
          error
        );
      }
    }
  }

  write(data) {
    const filePath =
      this.getPath();

    const directory =
      path.dirname(filePath);

    const temporaryPath =
      `${filePath}.tmp`;

    this.fileSystem.mkdirSync(
      directory,
      {
        recursive: true
      }
    );

    this.fileSystem.writeFileSync(
      temporaryPath,
      JSON.stringify(
        data,
        null,
        2
      ),
      "utf8"
    );

    try {
      this.fileSystem.renameSync(
        temporaryPath,
        filePath
      );
    } catch (error) {
      if (
        error?.code !== "EEXIST" &&
        error?.code !== "EPERM"
      ) {
        throw error;
      }

      this.fileSystem.rmSync(
        filePath,
        {
          force: true
        }
      );

      this.fileSystem.renameSync(
        temporaryPath,
        filePath
      );
    }
  }
}
