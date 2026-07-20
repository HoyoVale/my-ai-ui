import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import {
  sanitizeSettings
} from "../../electron/settings/validateSettings.js";

describe(
  "runtime context settings validation",
  () => {
    it(
      "sanitizes environment injection detail and privacy options",
      () => {
        const settings =
          sanitizeSettings({
            context: {
              environment: {
                enabled: false,
                profile: "invalid",
                includeTime: false,
                includeRuntimeVersions: true,
                includeWorkspace: true,
                workspaceDetail: "full",
                toolDetail: "names"
              }
            }
          });

        assert.equal(
          settings.context
            .environment.enabled,
          false
        );
        assert.equal(
          settings.context
            .environment.profile,
          "standard"
        );
        assert.equal(
          settings.context
            .environment.includeTime,
          false
        );
        assert.equal(
          settings.context
            .environment.includeRuntimeVersions,
          true
        );
        assert.equal(
          settings.context
            .environment.workspaceDetail,
          "full"
        );
        assert.equal(
          settings.context
            .environment.toolDetail,
          "names"
        );
      }
    );
  }
);

describe(
  "tool settings validation",
  () => {
    it(
      "clamps runtime and workspace limits while keeping tool overrides",
      () => {
        const settings =
          sanitizeSettings({
            tools: {
              enabled: true,
              profile: "custom",
              mode: "coding",
              runtime: {
                maxSteps: 999,
                maxSegments: 999,
                maxNoProgressSegments: 999,
                maxFinalizationAttempts: 999,
                finalizationTimeoutMs: 999999,
                maxToolCalls: 999,
                maxToolCallsPerStep: 999,
                maxToolCallsPerBatch: 999,
                maxTotalToolCalls: 99999,
                runTimeoutMs: 1,
                defaultTimeoutMs: 50,
                maxIdenticalCalls: 99,
                saveToolHistory: false,
                circuitBreakers: {
                  provider: {
                    failureThreshold: 99,
                    failureWindowMs: 1,
                    cooldownMs: 99999999,
                    halfOpenMaxCalls: 99
                  },
                  tool: {
                    failureThreshold: 0,
                    failureWindowMs: 99999999,
                    cooldownMs: 0,
                    halfOpenMaxCalls: 0
                  }
                }
              },
              workspace: {
                enabled: true,
                includeProjectRoot: true,
                roots: [
                  " C:\\Projects\\One ",
                  "C:\\Projects\\One",
                  "D:\\Notes"
                ],
                maxTextFileBytes: 1,
                maxReadLines: 99999,
                maxDirectoryEntries: 1,
                maxSearchResults: 9999,
                maxSearchDepth: 0,
                maxHashFileBytes: 999999999
              },
              toolsets: {
                "workspace.read": false
              },
              overrides: {
                calculator: false
              },
              developer: {
                toolsetOverrides: {
                  "workspace.read": "disabled"
                },
                toolOverrides: {
                  calculator: "disabled"
                }
              }
            }
          });

        assert.equal(
          settings.tools.runtime.maxSteps,
          32
        );
        assert.equal(
          settings.tools.runtime.maxSegments,
          100
        );
        assert.equal(
          settings.tools.runtime.maxNoProgressSegments,
          10
        );
        assert.equal(
          settings.tools.mode,
          "coding"
        );
        assert.equal(
          Object.hasOwn(settings.tools, "display"),
          false
        );
        assert.equal(
          settings.tools.runtime
            .maxFinalizationAttempts,
          3
        );
        assert.equal(
          settings.tools.runtime.finalizationTimeoutMs,
          120000
        );
        assert.equal(
          settings.tools.runtime.maxToolCalls,
          500
        );
        assert.equal(
          settings.tools.runtime.maxToolCallsPerStep,
          64
        );
        assert.equal(
          settings.tools.runtime.maxToolCallsPerBatch,
          128
        );
        assert.equal(
          settings.tools.runtime.maxTotalToolCalls,
          10000
        );
        assert.equal(
          settings.tools.runtime.runTimeoutMs,
          10000
        );
        assert.equal(
          settings.tools.runtime.maxIdenticalCalls,
          10
        );
        assert.equal(
          settings.tools.runtime
            .defaultTimeoutMs,
          2000
        );
        assert.equal(
          settings.tools.runtime
            .saveToolHistory,
          false
        );
        assert.deepEqual(
          settings.tools.runtime.circuitBreakers,
          {
            provider: {
              failureThreshold: 20,
              failureWindowMs: 5000,
              cooldownMs: 1800000,
              halfOpenMaxCalls: 10
            },
            tool: {
              failureThreshold: 1,
              failureWindowMs: 1800000,
              cooldownMs: 1000,
              halfOpenMaxCalls: 1
            }
          }
        );
        assert.deepEqual(
          settings.workspaces.items.map(
            (workspace) => workspace.rootPath
          ),
          [
            "C:\\Projects\\One",
            "D:\\Notes"
          ]
        );
        assert.equal(
          Object.hasOwn(
            settings.tools.workspace,
            "roots"
          ),
          false
        );
        assert.equal(
          Object.hasOwn(
            settings.tools.workspace,
            "includeProjectRoot"
          ),
          false
        );
        assert.equal(
          settings.tools.workspace
            .maxTextFileBytes,
          65536
        );
        assert.equal(
          settings.tools.workspace
            .maxReadLines,
          5000
        );
        assert.equal(
          settings.tools.workspace
            .maxDirectoryEntries,
          20
        );
        assert.equal(
          settings.tools.workspace
            .maxSearchResults,
          500
        );
        assert.equal(
          settings.tools.workspace
            .maxSearchDepth,
          1
        );
        assert.equal(
          settings.tools.workspace
            .maxHashFileBytes,
          200000000
        );
        assert.equal(
          settings.tools.toolsets[
            "workspace.read"
          ],
          false
        );
        assert.equal(
          settings.tools.overrides
            .calculator,
          false
        );
        assert.equal(
          settings.tools.overrides
            .get_current_time,
          true
        );
        assert.equal(
          settings.tools.developer
            .toolsetOverrides[
              "workspace.read"
            ],
          "disabled"
        );
        assert.equal(
          settings.tools.developer
            .toolOverrides.calculator,
          "disabled"
        );
      }
    );

    it(
      "migrates legacy custom Toolset switches into developer overrides",
      () => {
        const settings = sanitizeSettings({
          tools: {
            profile: "custom",
            toolsets: {
              "core.runtime": true,
              "workspace.read": false,
              "agent.internal": true
            },
            overrides: {
              calculator: false
            }
          }
        });

        assert.equal(
          settings.tools.mode,
          "chat"
        );
        assert.equal(
          settings.tools.developer
            .toolOverrides.calculator,
          "disabled"
        );
      }
    );
  }
);

it("Journal total quota never falls below the rolling file limit", () => {
  const sanitized = sanitizeSettings({
    tools: {
      runtime: {
        journalMaxFileBytes: 12_000_000,
        journalMaxTotalBytes: 1_000_000
      }
    }
  });

  assert.equal(sanitized.tools.runtime.journalMaxFileBytes, 12_000_000);
  assert.equal(sanitized.tools.runtime.journalMaxTotalBytes, 12_000_000);
});
