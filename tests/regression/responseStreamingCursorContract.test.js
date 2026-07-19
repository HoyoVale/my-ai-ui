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
  "Response streaming cursor",
  () => {
    it(
      "mounts the cursor inside the last rendered Markdown text block",
      () => {
        const source = read(
          "../../src/Response/components/StreamingMarkdown.jsx"
        );

        assert.match(
          source,
          /resolveCursorHost/u
        );
        assert.match(
          source,
          /querySelectorAll/u
        );
        assert.match(
          source,
          /createPortal/u
        );
        assert.match(
          source,
          /response-stream-cursor/u
        );
      }
    );

    it(
      "uses the flowing cursor for both answer and live activity text",
      () => {
        const bubble = read(
          "../../src/Response/components/Bubble.jsx"
        );
        const flow = read(
          "../../src/Response/components/ActivityFlow.jsx"
        );

        assert.match(
          bubble,
          /<StreamingMarkdown[\s\S]*cursor=\{streaming\}/u
        );
        assert.match(
          flow,
          /<StreamingMarkdown[\s\S]*cursor=\{streaming\}/u
        );
        assert.doesNotMatch(
          bubble,
          /<span[\s\S]*response-bubble__cursor/u
        );
      }
    );
  }
);
