import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import {
  resolveAssistantDisplayName
} from "../../src/shared/appIdentity.js";

describe("assistant display identity", () => {
  it("uses the configured personality name and a generic fallback", () => {
    assert.equal(
      resolveAssistantDisplayName({ personality: { name: "  Flora  " } }),
      "Flora"
    );
    assert.equal(
      resolveAssistantDisplayName({ personality: { name: "   " } }),
      "桌面助手"
    );
  });

  it("keeps tray labels derived from settings instead of a literal Xixi name", () => {
    const source = fs.readFileSync(
      "electron/windows/tray/trayManager.js",
      "utf8"
    );

    assert.match(source, /resolveAssistantDisplayName/u);
    assert.doesNotMatch(source, /退出 Xixi|setToolTip\("Xixi"\)/u);
  });
});
