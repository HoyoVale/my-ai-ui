import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  recoverAtomicSettingsFile,
  writeSettingsJsonAtomic
} from "../../electron/settings/settingsFileWriter.js";

function temporaryDirectory() {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), "xixi-settings-writer-")
  );
}

function readJson(target) {
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function replacementFileSystem(target, failures) {
  let replacementAttempt = 0;

  return {
    ...fs,
    renameSync(source, destination) {
      if (
        destination === target &&
        source.includes(".tmp")
      ) {
        const code = failures[replacementAttempt];
        replacementAttempt += 1;
        if (code) {
          const error = new Error(code);
          error.code = code;
          throw error;
        }
      }
      return fs.renameSync(source, destination);
    }
  };
}

describe("atomic settings file writer", () => {
  it("writes and replaces one settings file", () => {
    const directory = temporaryDirectory();
    const target = path.join(directory, "settings.json");

    writeSettingsJsonAtomic(target, { version: 1 });
    writeSettingsJsonAtomic(target, { version: 2 });

    assert.deepEqual(readJson(target), { version: 2 });
    assert.equal(fs.existsSync(`${target}.bak`), false);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("uses the guarded Windows replacement path", () => {
    const directory = temporaryDirectory();
    const target = path.join(directory, "settings.json");
    writeSettingsJsonAtomic(target, { version: 1 });

    writeSettingsJsonAtomic(
      target,
      { version: 2 },
      {
        fileSystem: replacementFileSystem(target, ["EPERM", null])
      }
    );

    assert.deepEqual(readJson(target), { version: 2 });
    assert.equal(fs.existsSync(`${target}.bak`), false);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("restores the old settings when replacement fails", () => {
    const directory = temporaryDirectory();
    const target = path.join(directory, "settings.json");
    writeSettingsJsonAtomic(target, { version: 1 });

    assert.throws(
      () => writeSettingsJsonAtomic(
        target,
        { version: 2 },
        {
          fileSystem: replacementFileSystem(target, ["EPERM", "EIO"])
        }
      ),
      /EIO/u
    );

    assert.deepEqual(readJson(target), { version: 1 });
    assert.equal(fs.existsSync(`${target}.bak`), false);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("recovers an interrupted backup before reading", () => {
    const directory = temporaryDirectory();
    const target = path.join(directory, "settings.json");
    writeSettingsJsonAtomic(target, { version: 1 });
    fs.renameSync(target, `${target}.bak`);

    const result = recoverAtomicSettingsFile(target);

    assert.equal(result.recovered, true);
    assert.deepEqual(readJson(target), { version: 1 });
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
