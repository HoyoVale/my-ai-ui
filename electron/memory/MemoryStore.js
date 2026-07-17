import fs from "node:fs";
import path from "node:path";

import {
  createEmptyMemoryData,
  sanitizeMemoryData
} from "./memorySchema.js";

function clone(value) {
  return structuredClone(value);
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

      this.cache =
        sanitizeMemoryData(
          JSON.parse(text)
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
