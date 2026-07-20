import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";
import fs from "node:fs";

function read(relativePath) {
  return fs.readFileSync(
    new URL(relativePath, import.meta.url),
    "utf8"
  );
}

describe("Electron runtime crash fixture contract", () => {
  it("uses named arguments so Chromium flags do not shift fixture inputs", () => {
    const launcher = read("../e2e/electron-runtime-crash-recovery.cjs");
    const fixture = read("../fixtures/electron-runtime-crash-main.cjs");

    assert.match(launcher, /`--stage=\$\{stage\}`/u);
    assert.match(launcher, /`--workspace-root=\$\{workspaceRoot\}`/u);
    assert.match(fixture, /requireArgument\("stage"\)/u);
    assert.match(fixture, /process\.argv\.find/u);
    assert.doesNotMatch(fixture, /process\.argv\.slice\(2\)/u);
  });
});
