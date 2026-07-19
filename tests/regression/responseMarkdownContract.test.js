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
  "Response markdown contract",
  () => {
    it(
      "renders the final response separately through the shared Markdown component",
      () => {
        const source =
          read(
            "../../src/Response/components/Bubble.jsx"
          );

        assert.match(
          source,
          /MarkdownContent/u
        );
        assert.match(
          source,
          /content=\{answerText\}/u
        );
        assert.match(
          source,
          /ResponseActivityFlow/u
        );
      }
    );

    it(
      "uses the shared renderer with Markdown and LaTeX support",
      () => {
        const source =
          read(
            "../../src/Conversation/components/MarkdownContent.jsx"
          );

        assert.match(
          source,
          /remarkMath/u
        );
        assert.match(
          source,
          /katex\.renderToString/u
        );
        assert.match(
          source,
          /katex\/dist\/katex\.min\.css/u
        );
      }
    );

    it(
      "styles code blocks, tables and structured activity inside the response bubble",
      () => {
        const source =
          read(
            "../../src/Response/Response.css"
          );

        assert.match(
          source,
          /response-bubble \.markdown-code-block/u
        );
        assert.match(
          source,
          /response-bubble \.markdown-table-card/u
        );
        assert.match(
          source,
          /response-activity__events/u
        );
        assert.match(
          source,
          /response-bubble__answer\.has-activity/u
        );
      }
    );
  }
);
