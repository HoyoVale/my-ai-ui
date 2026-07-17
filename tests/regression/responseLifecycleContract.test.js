import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import fs from "node:fs";

describe(
  "Response lifecycle regression",
  () => {
    it(
      "resets dismissal and actively reveals the next streamed reply",
      () => {
        const source =
          fs.readFileSync(
            new URL(
              "../../electron/windows/response/ResponseWindowController.js",
              import.meta.url
            ),
            "utf8"
          );

        assert.match(
          source,
          /this\.dismissed\s*=\s*false/
        );

        assert.match(
          source,
          /appendChunk[\s\S]*revealForStream\(\)/
        );
      }
    );
  }
);
