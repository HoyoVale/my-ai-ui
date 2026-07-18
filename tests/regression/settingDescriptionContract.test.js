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
  "Setting description contract",
  () => {
    it(
      "does not render subtitle text below section and row titles",
      () => {
        const controls = read(
          "../../src/Setting/components/Controls.jsx"
        );

        assert.doesNotMatch(
          controls,
          /settings-row__description/u
        );
        assert.doesNotMatch(
          controls,
          /<p>\{description\}<\/p>/u
        );
      }
    );
  }
);
