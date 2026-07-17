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
  "conversation settings validation",
  () => {
    it(
      "clamps conversation limits",
      () => {
        const settings =
          sanitizeSettings({
            conversation: {
              contextTurns: 999,
              maxConversations: 1,
              autoTitle: "yes",
              saveAbortedReplies:
                false
            }
          });

        assert.equal(
          settings
            .conversation
            .contextTurns,
          50
        );

        assert.equal(
          settings
            .conversation
            .maxConversations,
          10
        );

        assert.equal(
          settings
            .conversation
            .autoTitle,
          true
        );

        assert.equal(
          settings
            .conversation
            .saveAbortedReplies,
          false
        );
      }
    );
  }
);
