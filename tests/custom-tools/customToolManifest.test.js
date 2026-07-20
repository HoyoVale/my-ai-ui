import {
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  getToolManifestSnapshot
} from "../../electron/tools/manifest/ToolManifestService.js";

import {
  sanitizeSettings
} from "../../electron/settings/validateSettings.js";

it("publishes configured HTTP tools through the unified Manifest", () => {
  const settings = sanitizeSettings({
    customTools: {
      enabled: true,
      tools: [
        {
          id: "weather",
          name: "Weather",
          enabled: true,
          method: "GET",
          url: "https://api.example.com/weather",
          authMode: "none",
          parameters: []
        }
      ]
    }
  });

  const manifest = getToolManifestSnapshot({ settings });
  const tool = manifest.tools.find((item) => item.source === "custom.http.weather");
  assert.ok(tool);
  assert.equal(manifest.sourceSummary.custom, 1);
  assert.equal(tool.sourceKind, "custom");
  assert.equal(tool.toolsetId, "custom.weather");
  assert.equal(tool.customHttp.method, "GET");
  assert.equal(tool.ready, true);
});
