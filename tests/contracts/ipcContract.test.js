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
            .CHANGED,
          "conversation-changed"
        );
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
