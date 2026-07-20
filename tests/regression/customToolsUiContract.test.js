import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";
import fs from "node:fs";

const tabs = fs.readFileSync(
  new URL("../../src/Setting/constants/Tabs.js", import.meta.url),
  "utf8"
);
const content = fs.readFileSync(
  new URL("../../src/Setting/components/Content.jsx", import.meta.url),
  "utf8"
);
const panel = fs.readFileSync(
  new URL("../../src/Setting/panels/CustomToolsPanel.jsx", import.meta.url),
  "utf8"
);


describe("Custom Tools Setting UX contract", () => {
  it("places Custom Tools under the AI group for normal users", () => {
    const aiStart = tabs.indexOf('id: "ai"');
    const customIndex = tabs.indexOf('id: "custom-tools"');
    const developerStart = tabs.indexOf('id: "developer"');
    assert.equal(customIndex > aiStart, true);
    assert.equal(customIndex < developerStart, true);
    assert.match(content, /<CustomToolsPanel/u);
  });

  it("supports CRUD, credentials, structured parameters and test calls", () => {
    assert.match(panel, /custom-tool-add/u);
    assert.match(panel, /ParameterEditor/u);
    assert.match(panel, /setCustomToolSecret/u);
    assert.match(panel, /testCustomHttpTool/u);
    assert.match(panel, /allowPrivateNetwork/u);
  });
});
