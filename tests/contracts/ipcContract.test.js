import {
  createRequire
} from "node:module";

import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import fs from "node:fs";

const require =
  createRequire(
    import.meta.url
  );

const channels =
  require(
    "../../electron/shared/ipcChannels.cjs"
  );

function flattenValues(
  source
) {
  return Object.values(
    source
  ).flatMap((value) => {
    if (
      value &&
      typeof value ===
        "object"
    ) {
      return flattenValues(
        value
      );
    }

    return [value];
  });
}

describe(
  "IPC contract",
  () => {
    it(
      "keeps all main-process channel names represented in preload",
      () => {
        const preload =
          fs.readFileSync(
            new URL(
              "../../electron/preload/preload.cjs",
              import.meta.url
            ),
            "utf8"
          );

        for (
          const channel
          of flattenValues(
            channels
          )
        ) {
          assert.equal(
            preload.includes(
              `"${channel}"`
            ),
            true,
            `Missing preload channel: ${channel}`
          );
        }
      }
    );

    it(
      "exposes conversation channels",
      () => {
        assert.equal(
          channels
            .conversation
            .GET_STATE,
          "conversation-get-state"
        );

        assert.equal(
          channels
            .conversation
            .INSPECT_CONTEXT,
          "conversation-inspect-context"
        );

        assert.equal(
          channels
            .conversation
            .RENAME,
          "conversation-rename"
        );

        assert.equal(
          channels
            .conversation
            .REGENERATE_MESSAGE,
          "conversation-regenerate-message"
        );

        assert.equal(
          channels
            .conversation
            .CHANGED,
          "conversation-changed"
        );
      }
    );

    it(
      "exposes the safe external-link channel",
      () => {
        assert.equal(
          channels
            .security
            .OPEN_EXTERNAL_URL,
          "security-open-external-url"
        );
      }
    );

    it(
      "exposes the workspace directory picker channel",
      () => {
        assert.equal(
          channels
            .settings
            .SELECT_DIRECTORY,
          "settings-select-directory"
        );
      }
    );

    it(
      "exposes Manifest and Effective Prompt inspection channels",
      () => {
        assert.equal(
          channels.tools.GET_MANIFEST,
          "tools-get-manifest"
        );
        assert.equal(
          channels.developer.INSPECT_PROMPT,
          "developer-inspect-prompt"
        );
      }
    );

    it(
      "exposes MCP management channels",
      () => {
        assert.equal(channels.mcp.GET_STATE, "mcp-get-state");
        assert.equal(channels.mcp.CONNECT, "mcp-connect");
        assert.equal(channels.mcp.DISCONNECT, "mcp-disconnect");
        assert.equal(channels.mcp.REFRESH, "mcp-refresh");
        assert.equal(channels.mcp.PING, "mcp-ping");
        assert.equal(channels.mcp.SET_SECRET, "mcp-set-secret");
        assert.equal(channels.mcp.CLEAR_SECRET, "mcp-clear-secret");
        assert.equal(channels.mcp.CHANGED, "mcp-changed");
      }
    );

    it(
      "exposes memory channels",
      () => {
        assert.equal(
          channels.memory.GET_STATE,
          "memory-get-state"
        );
        assert.equal(
          channels.memory.CHANGED,
          "memory-changed"
        );
      }
    );
  }
);
