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
  "Response width settings",
  () => {
    it(
      "uses bubbleMaxWidth as the activity bubble maximum instead of a fixed 340 px cap",
      () => {
        const response = read(
          "../../src/Response/Response.jsx"
        );
        const css = read(
          "../../src/Response/Response.css"
        );

        assert.match(
          response,
          /--response-max-width[\s\S]*response\.bubbleMaxWidth/u
        );

        assert.match(
          css,
          /\.response-bubble\.has-activity\s*\{[\s\S]*var\(--response-max-width\)/u
        );

        assert.doesNotMatch(
          css,
          /\.response-bubble\.has-activity\s*\{[\s\S]{0,120}340px/u
        );
      }
    );
  }
);
