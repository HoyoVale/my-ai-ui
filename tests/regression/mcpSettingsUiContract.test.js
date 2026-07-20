import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function read(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("MCP Setting UX contract", () => {
  it("places MCP under AI and keeps it available outside developer mode", () => {
    const tabs = read("../../src/Setting/constants/Tabs.js");
    const setting = read("../../src/Setting/Setting.jsx");

    const aiStart = tabs.indexOf('id: "ai"');
    const mcpIndex = tabs.indexOf('id: "mcp"');
    const developerStart = tabs.indexOf('id: "developer"');

    assert.equal(aiStart >= 0, true);
    assert.equal(mcpIndex > aiStart, true);
    assert.equal(mcpIndex < developerStart, true);
    assert.doesNotMatch(setting, /\["developer", "mcp"\]/u);
  });

  it("offers remote, local and GitHub connection paths", () => {
    const panel = read("../../src/Setting/panels/McpPanel.jsx");

    assert.match(panel, /mcp-add-connection/u);
    assert.match(panel, /mcp-add-remote/u);
    assert.match(panel, /mcp-add-github/u);
    assert.match(panel, /streamable-http/u);
    assert.match(panel, /浏览器登录（OAuth）/u);
    assert.match(panel, /Bearer Token/u);
    assert.match(panel, /API Key/u);
  });

  it("keeps advanced MCP diagnostics developer-only", () => {
    const panel = read("../../src/Setting/panels/McpPanel.jsx");

    assert.match(panel, /developerMode &&/u);
    assert.match(panel, /高级设置/u);
    assert.match(panel, /Server 日志/u);
  });
});
