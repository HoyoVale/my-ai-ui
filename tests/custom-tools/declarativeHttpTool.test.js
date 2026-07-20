import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  createDeclarativeHttpDefinition,
  executeDeclarativeHttpTool
} from "../../electron/custom-tools/declarativeHttpTool.js";

function config(overrides = {}) {
  return {
    id: "weather",
    name: "Weather API",
    description: "Read weather information.",
    enabled: true,
    method: "GET",
    url: "http://localhost:8787/weather/{city}",
    authMode: "bearer",
    apiKeyHeader: "X-API-Key",
    headers: { "X-Client": "my-ai-ui" },
    parameters: [
      {
        name: "city",
        location: "path",
        type: "string",
        required: true,
        description: "City"
      },
      {
        name: "days",
        location: "query",
        type: "integer",
        required: false,
        description: "Forecast days"
      }
    ],
    responsePath: "data.temperature",
    timeoutMs: 15000,
    maxResponseBytes: 65536,
    allowPrivateNetwork: false,
    ...overrides
  };
}


describe("Declarative HTTP Tool", () => {
  it("builds a safe read definition with a structured schema", async () => {
    const requests = [];
    const definition = createDeclarativeHttpDefinition(config(), {
      secretResolver: async () => "secret-token",
      fetchImpl: async (url, options) => {
        requests.push({ url: String(url), options });
        return new Response(JSON.stringify({ data: { temperature: 28 } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });

    assert.equal(definition.source, "custom.http.weather");
    assert.deepEqual(definition.toolsets, ["custom.weather"]);
    assert.equal(definition.sideEffect, "read");
    assert.equal(definition.runtimeContract.retryMode, "safe");
    assert.match(definition.name, /^custom_http_weather_[a-f0-9]{8}$/u);

    const parsed = definition.inputSchema.safeParse({ city: "深圳", days: 3 });
    assert.equal(parsed.success, true);

    const result = await definition.execute({ city: "深圳", days: 3 }, {});
    assert.equal(result.ok, true);
    assert.equal(result.extracted, 28);
    assert.match(requests[0].url, /weather\/%E6%B7%B1%E5%9C%B3\?days=3/u);
    assert.equal(requests[0].options.headers.get("Authorization"), "Bearer secret-token");
    assert.equal(requests[0].options.redirect, "manual");
  });

  it("maps write methods to remote side effects and JSON bodies", async () => {
    let body = null;
    const definition = createDeclarativeHttpDefinition(config({
      method: "POST",
      authMode: "none",
      url: "http://localhost:8787/items",
      parameters: [
        {
          name: "title",
          location: "body",
          type: "string",
          required: true,
          description: "Title"
        }
      ]
    }), {
      fetchImpl: async (_url, options) => {
        body = options.body;
        return new Response(JSON.stringify({ id: 7 }), {
          status: 201,
          headers: { "content-type": "application/json" }
        });
      }
    });

    assert.equal(definition.sideEffect, "external");
    assert.equal(definition.runtimeContract.effect, "remote_write");
    assert.equal(definition.runtimeContract.retryMode, "reconcile_before_retry");

    const result = await definition.execute({ title: "Hello" }, {});
    assert.deepEqual(JSON.parse(body), { title: "Hello" });
    assert.equal(result.status, 201);
  });

  it("blocks redirects and returns bounded response previews", async () => {
    await assert.rejects(
      () => executeDeclarativeHttpTool(config({ authMode: "none" }), {
        city: "x"
      }, {
        fetchImpl: async () => new Response(null, {
          status: 302,
          headers: { location: "https://example.com/next" }
        })
      }),
      (error) => error.code === "POLICY_DENIED"
    );

    const result = await executeDeclarativeHttpTool(config({
      authMode: "none",
      maxResponseBytes: 8,
      responsePath: ""
    }), { city: "x" }, {
      fetchImpl: async () => new Response("abcdefghijklmnop", {
        status: 200,
        headers: { "content-type": "text/plain" }
      })
    });
    assert.equal(result.truncated, true);
    assert.equal(result.data, "abcdefgh");
  });

  it("classifies HTTP failures for Runtime retry policy", async () => {
    await assert.rejects(
      () => executeDeclarativeHttpTool(config({ authMode: "none" }), {
        city: "x"
      }, {
        fetchImpl: async () => new Response("busy", { status: 503 })
      }),
      (error) => error.code === "TEMPORARY_FAILURE"
    );
  });
});
