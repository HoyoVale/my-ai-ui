import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const developerPanel = fs.readFileSync(
  new URL("../../src/Setting/panels/DeveloperPanel.jsx", import.meta.url),
  "utf8"
);
const settingCss = fs.readFileSync(
  new URL("../../src/Setting/Setting.css", import.meta.url),
  "utf8"
);

test("Developer panel exposes the capability inspector and manifest revision", () => {
  assert.match(developerPanel, /data-testid="developer-capability-inspector"/u);
  assert.match(developerPanel, /Capability Inspector/u);
  assert.match(developerPanel, /manifestRevision/u);
  assert.match(developerPanel, /taxonomyHash/u);
  assert.match(settingCss, /\.capability-inspector/u);
  assert.match(settingCss, /\.capability-permission-list/u);
});
