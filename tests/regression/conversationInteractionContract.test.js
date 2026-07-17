import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import fs from "node:fs";

function read(relativePath) {
  return fs.readFileSync(
    new URL(
      relativePath,
      import.meta.url
    ),
    "utf8"
  );
}

describe(
  "Conversation interaction contract",
  () => {
    it(
      "shows user timestamps and keeps context controls on assistant messages",
      () => {
        const source =
          read(
            "../../src/Conversation/components/MessageList.jsx"
          );

        assert.match(
          source,
          /conversation-message__time/u
        );
        assert.match(
          source,
          /固定到本会话/u
        );
        assert.match(
          source,
          /加入上下文/u
        );
        assert.match(
          source,
          /isAssistant\s*&&\s*\(\s*<>[\s\S]*message-pin-toggle/u
        );
      }
    );

    it(
      "hides message actions until hover or keyboard focus",
      () => {
        const source =
          read(
            "../../src/Conversation/Conversation.css"
          );

        assert.match(
          source,
          /conversation-message__action-group\s*\{[\s\S]*opacity:\s*0/u
        );
        assert.match(
          source,
          /conversation-message:hover\s+\.conversation-message__action-group/u
        );
      }
    );

    it(
      "provides inline session rename controls",
      () => {
        const sidebar =
          read(
            "../../src/Conversation/components/Sidebar.jsx"
          );

        assert.match(
          sidebar,
          /conversation-rename-input/u
        );
        assert.match(
          sidebar,
          /conversation-rename/u
        );
        assert.match(
          sidebar,
          /onRename/u
        );
      }
    );
  }
);
