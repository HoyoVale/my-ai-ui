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


describe(
  "conversation window settings validation",
  () => {
    it(
      "clamps layout and preserves booleans",
      () => {
        const settings =
          sanitizeSettings({
            conversationWindow: {
              sidebarWidth: 999,
              messageMaxWidth: 10,
              fontSize: 40,
              compactList: true,
              showPreview: false,
              alwaysOnTop: true
            }
          });

        assert.equal(
          settings
            .conversationWindow
            .sidebarWidth,
          420
        );

        assert.equal(
          settings
            .conversationWindow
            .messageMaxWidth,
          520
        );

        assert.equal(
          settings
            .conversationWindow
            .fontSize,
          22
        );

        assert.equal(
          settings
            .conversationWindow
            .compactList,
          true
        );

        assert.equal(
          settings
            .conversationWindow
            .showPreview,
          false
        );

        assert.equal(
          settings
            .conversationWindow
            .alwaysOnTop,
          true
        );
      }
    );
  }
);
