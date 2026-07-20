import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  sanitizeSettings
} from "../../electron/settings/validateSettings.js";


describe("declarative HTTP tool settings", () => {
  it("sanitizes tools, parameters and network limits", () => {
    const settings = sanitizeSettings({
      customTools: {
        enabled: true,
        maxResponseBytes: 9_000_000,
        tools: [
          {
            id: "Weather API!",
            name: "Weather",
            enabled: true,
            method: "post",
            url: "https://api.example.com/weather/{city}",
            authMode: "api-key",
            apiKeyHeader: "X-Weather-Key",
            headers: {
              "X-Client": "my-ai-ui",
              Authorization: "must-not-persist"
            },
            parameters: [
              {
                name: "city",
                location: "path",
                type: "string",
                required: true,
                description: "City name"
              },
              {
                name: "city",
                location: "body",
                type: "object"
              }
            ],
            timeoutMs: 999999,
            maxResponseBytes: 1,
            responsePath: ".data.items."
          }
        ]
      }
    });

    assert.equal(settings.customTools.maxResponseBytes, 2_000_000);
    assert.equal(settings.customTools.tools.length, 1);
    const tool = settings.customTools.tools[0];
    assert.equal(tool.id, "weather-api");
    assert.equal(tool.method, "POST");
    assert.equal(tool.authMode, "api-key");
    assert.deepEqual(tool.headers, { "X-Client": "my-ai-ui" });
    assert.deepEqual(tool.parameters.map((item) => item.name), ["city", "city_2"]);
    assert.equal(tool.timeoutMs, 300000);
    assert.equal(tool.maxResponseBytes, 4096);
    assert.equal(tool.responsePath, "data.items");
  });

  it("preserves external Toolset and tool overrides", () => {
    const settings = sanitizeSettings({
      tools: {
        developer: {
          toolsetOverrides: {
            "custom.weather": "disabled"
          },
          toolOverrides: {
            custom_http_weather_12345678: "enabled"
          }
        }
      }
    });

    assert.equal(
      settings.tools.developer.toolsetOverrides["custom.weather"],
      "disabled"
    );
    assert.equal(
      settings.tools.developer.toolOverrides.custom_http_weather_12345678,
      "enabled"
    );
  });
});
