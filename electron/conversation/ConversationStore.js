import fs from "node:fs";
import path from "node:path";

import {
  createEmptyConversationData,
  sanitizeConversationData
} from "./conversationSchema.js";

import {
  AsyncPersistenceQueue
} from "../persistence/AsyncPersistenceQueue.js";

function clone(value) {
  return structuredClone(value);
}

async function callFileSystem(
  fileSystem,
  method,
  syncMethod,
  ...args
) {
  const asyncMethod = fileSystem.promises?.[method];

  if (typeof asyncMethod === "function") {
    return asyncMethod.call(fileSystem.promises, ...args);
  }

  return Promise.resolve().then(() =>
    fileSystem[syncMethod](...args)
  );
}

export class ConversationStore {
  constructor({
    getFilePath,
    fileSystem = fs,
    writeDelayMs = 150
  }) {
    if (
      typeof getFilePath !==
      "function"
    ) {
      throw new TypeError(
        "ConversationStore requires getFilePath()."
      );
    }

    this.getFilePath =
      getFilePath;

    this.fileSystem =
      fileSystem;

    this.cache = null;
    this.writeQueue =
      new AsyncPersistenceQueue({
        delayMs: writeDelayMs,
        write: (data) =>
          this.writeAsync(data),
        onError: (error) => {
          console.warn(
            "写入会话文件失败：",
            error
          );
        }
      });
  }

  getPath() {
    return this.getFilePath();
  }

  load() {
    if (this.cache) {
      return clone(
        this.cache
      );
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
        sanitizeConversationData(
          JSON.parse(text)
        );
    } catch (error) {
      if (
        error?.code !== "ENOENT"
      ) {
        console.warn(
          "读取会话文件失败，将创建新文件：",
          error
        );
      }

      this.cache =
        createEmptyConversationData();
    }

    this.scheduleWrite(
      this.cache
    );

    return clone(
      this.cache
    );
  }

  save(data) {
    this.cache =
      sanitizeConversationData(
        data
      );

    this.scheduleWrite(
      this.cache
    );

    return clone(
      this.cache
    );
  }

  flush() {
    return this.writeQueue.flush();
  }

  clearCache() {
    this.cache = null;
  }

  scheduleWrite(data) {
    this.writeQueue.enqueue(data);
  }

  async writeAsync(data) {
    const filePath =
      this.getPath();

    const directory =
      path.dirname(
        filePath
      );

    const temporaryPath =
      `${filePath}.tmp`;

    await callFileSystem(
      this.fileSystem,
      "mkdir",
      "mkdirSync",
      directory,
      {
        recursive: true
      }
    );

    const content =
      JSON.stringify(
        data,
        null,
        2
      );

    await callFileSystem(
      this.fileSystem,
      "writeFile",
      "writeFileSync",
      temporaryPath,
      content,
      "utf8"
    );

    try {
      await callFileSystem(
        this.fileSystem,
        "rename",
        "renameSync",
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

      await callFileSystem(
        this.fileSystem,
        "rm",
        "rmSync",
        filePath,
        {
          force: true
        }
      );

      await callFileSystem(
        this.fileSystem,
        "rename",
        "renameSync",
        temporaryPath,
        filePath
      );
    }
  }
}
