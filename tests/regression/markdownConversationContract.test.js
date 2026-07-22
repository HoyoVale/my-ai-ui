import {
  readConversationStyles
} from "../helpers/conversationUiSource.js";

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
  "Conversation markdown UI contract",
  () => {
    it(
      "uses React Markdown with GFM and independent code/table copy controls",
      () => {
        const source =
          read(
            "../../src/Conversation/components/MarkdownContent.jsx"
          );

        assert.match(
          source,
          /react-markdown/u
        );
        assert.match(
          source,
          /remark-gfm/u
        );
        assert.match(
          source,
          /复制代码/u
        );
        assert.match(
          source,
          /复制表格/u
        );
      }
    );

    it(
      "keeps assistant replies unwrapped while user messages use the compact bubble class",
      () => {
        const source =
          readConversationStyles();

        assert.match(
          source,
          /conversation-message--user[\s\S]*conversation-message__body/u
        );
        assert.doesNotMatch(
          source,
          /conversation-message--assistant\s+\.conversation-message__body\s*\{[^}]*background/u
        );
      }
    );
  }
);
