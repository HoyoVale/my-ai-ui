import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  FALLBACK_SETTINGS
} from "../../src/shared/defaultSettings.js";

import {
  getToolManifestSnapshot
} from "../../electron/tools/manifest/ToolManifestService.js";

function settingsWith(patch = {}) {
  const settings = structuredClone(FALLBACK_SETTINGS);
  return {
    ...settings,
    ...patch,
    tools: {
      ...settings.tools,
      ...(patch.tools ?? {}),
      runtime: {
        ...settings.tools.runtime,
        ...(patch.tools?.runtime ?? {})
      },
      workspace: {
        ...settings.tools.workspace,
        ...(patch.tools?.workspace ?? {})
      },
      developer: {
        ...settings.tools.developer,
        ...(patch.tools?.developer ?? {}),
        toolsetOverrides: {
          ...settings.tools.developer.toolsetOverrides,
          ...(patch.tools?.developer?.toolsetOverrides ?? {})
        },
        toolOverrides: {
          ...settings.tools.developer.toolOverrides,
          ...(patch.tools?.developer?.toolOverrides ?? {})
        }
      }
    }
  };
}

describe("Tool Manifest API", () => {
  it("publishes one stable, schema-backed manifest for all built-in tools", () => {
    const manifest = getToolManifestSnapshot({
      settings: settingsWith({
        tools: {
          mode: "chat",
          workspace: { roots: [] }
        }
      })
    });

    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.tools.length, 28);
    assert.equal(new Set(manifest.tools.map((tool) => tool.id)).size, 28);
    assert.equal(new Set(manifest.tools.map((tool) => tool.name)).size, 28);
    assert.match(manifest.revision, /^[a-f0-9]{20}$/u);
    assert.equal(manifest.sourceSummary.builtin, 28);
    assert.equal(manifest.sourceSummary.mcp, 0);
    assert.equal(manifest.sourceSummary.custom, 0);

    for (const tool of manifest.tools) {
      assert.equal(typeof tool.displayTitle, "string");
      assert.equal(tool.displayTitle.length > 0, true);
      assert.equal(typeof tool.displayDescription, "string");
      assert.equal(tool.displayDescription.length > 0, true);
      assert.equal(typeof tool.inputSchema, "object");
      assert.equal(typeof tool.outputSchema, "object");
      assert.equal(tool.editable.implementation, false);
      assert.equal(tool.editable.schema, false);
      assert.equal(tool.editable.override, true);
    }
  });

  it("keeps unavailable workspace tools discoverable without exposing them to the model", () => {
    const manifest = getToolManifestSnapshot({
      settings: settingsWith({
        tools: {
          mode: "coding",
          workspace: { roots: [] }
        }
      })
    });
    const read = manifest.tools.find((tool) => tool.name === "read_text_file");
    const batchRead = manifest.tools.find((tool) => tool.name === "read_multiple_files");
    const gitDiff = manifest.tools.find((tool) => tool.name === "git_diff");
    const write = manifest.tools.find((tool) => tool.name === "write_text_file");

    assert.equal(read.effectiveEnabled, true);
    assert.equal(batchRead.effectiveEnabled, true);
    assert.equal(gitDiff.effectiveEnabled, true);
    assert.equal(read.available, false);
    assert.equal(read.ready, false);
    assert.match(read.availabilityReason, /没有绑定工作区/u);
    assert.equal(write.effectiveEnabled, true);
    assert.equal(write.available, false);
    assert.equal(write.ready, false);
  });

  it("derives Toolset and tool tri-state overrides from the same manifest", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tool-manifest-"));
    try {
      const manifest = getToolManifestSnapshot({
        settings: settingsWith({
          tools: {
            mode: "coding",
            workspace: {
              roots: [root],
              allowedCommands: ["node"]
            },
            developer: {
              toolsetOverrides: {
                "workspace.exec": "enabled"
              },
              toolOverrides: {
                search_text: "disabled"
              }
            }
          }
        })
      });

      assert.equal(manifest.tools.find((tool) => tool.name === "write_text_file").ready, true);
      assert.equal(manifest.tools.find((tool) => tool.name === "git_inspect").ready, true);
      assert.equal(manifest.tools.find((tool) => tool.name === "run_workspace_command").ready, true);
      assert.equal(manifest.tools.find((tool) => tool.name === "search_text").ready, false);
      assert.equal(manifest.tools.find((tool) => tool.name === "search_text").override, "disabled");
      assert.equal(
        manifest.toolsets.find((toolset) => toolset.id === "workspace.exec").override,
        "enabled"
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("publishes the conversation-bound execution context used by the settings UI", () => {
    const manifest = getToolManifestSnapshot({
      settings: settingsWith({
        tools: { mode: "coding" }
      }),
      executionContext: {
        conversationId: "conversation-a",
        conversationTitle: "Coding session",
        mode: "coding",
        workspaceId: "workspace-a",
        workspaceAvailable: true
      }
    });

    assert.equal(manifest.mode, "coding");
    assert.equal(manifest.executionContext.conversationId, "conversation-a");
    assert.equal(manifest.executionContext.mode, "coding");
    assert.equal(manifest.activeModel === null || typeof manifest.activeModel === "object", true);
  });

});
