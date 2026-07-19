import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  DEFAULT_SETTINGS
} from "../../electron/settings/defaultSettings.js";
import {
  FALLBACK_SETTINGS
} from "../../src/shared/defaultSettings.js";

function read(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("Tool Runtime Kernel dependency boundary", () => {
  it("keeps the Executor independent from Agent stores and the AI SDK", () => {
    const coreDirectory = new URL("../../electron/tools/core/", import.meta.url);
    const sources = fs
      .readdirSync(coreDirectory)
      .filter((name) => name.endsWith(".js"))
      .map((name) => read(`../../electron/tools/core/${name}`))
      .join("\n");
    const source = read("../../electron/tools/core/ToolExecutor.js");

    assert.doesNotMatch(sources, /from\s+["']ai["']/u);
    assert.doesNotMatch(sources, /\.\.\/\.\.\/agent|\.\.\/agent/u);
    assert.doesNotMatch(source, /planStore|activityStore/u);
    assert.doesNotMatch(sources, /electron\/(agent|conversation)/u);
  });

  it("keeps Electron and Renderer orchestration limits aligned", () => {
    const electronRuntime = DEFAULT_SETTINGS.tools.runtime;
    const rendererRuntime = FALLBACK_SETTINGS.tools.runtime;
    assert.equal(
      DEFAULT_SETTINGS,
      FALLBACK_SETTINGS
    );

    assert.equal(
      rendererRuntime.maxFinalizationAttempts,
      electronRuntime.maxFinalizationAttempts
    );
    assert.equal(
      rendererRuntime.maxSegments,
      electronRuntime.maxSegments
    );
    assert.equal(
      rendererRuntime.maxNoProgressSegments,
      electronRuntime.maxNoProgressSegments
    );
    assert.equal(
      rendererRuntime.finalizationTimeoutMs,
      electronRuntime.finalizationTimeoutMs
    );
    assert.equal(
      rendererRuntime.maxToolCallsPerStep,
      electronRuntime.maxToolCallsPerStep
    );
    assert.equal(
      rendererRuntime.maxToolCallsPerBatch,
      electronRuntime.maxToolCallsPerBatch
    );
  });
});
