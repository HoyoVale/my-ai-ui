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
const toolPanel = fs.readFileSync(
  new URL("../../src/Setting/panels/ToolPanel.jsx", import.meta.url),
  "utf8"
);
const panel = fs.readFileSync(
  new URL("../../src/Setting/panels/CustomToolsPanel.jsx", import.meta.url),
  "utf8"
);


describe("Custom Tools Setting UX contract", () => {
  it("merges Custom Tools into Tools instead of exposing a standalone tab", () => {
    assert.doesNotMatch(tabs, /id: "custom-tools"/u);
    assert.doesNotMatch(content, /custom-tools:/u);
    assert.match(toolPanel, /<CustomToolsPanel/u);
    assert.match(toolPanel, /custom-tools-in-tools/u);
    assert.match(toolPanel, /Custom HTTP/u);
  });

  it("supports CRUD, credentials, structured parameters and test calls", () => {
    assert.match(panel, /custom-tool-add/u);
    assert.match(panel, /ParameterEditor/u);
    assert.match(panel, /setCustomToolSecret/u);
    assert.match(panel, /testCustomHttpTool/u);
    assert.match(panel, /allowPrivateNetwork/u);
  });
});
