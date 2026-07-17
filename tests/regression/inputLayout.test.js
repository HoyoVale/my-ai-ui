import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import {
  calculateInputHeights
} from "../../src/Input/utils/inputLayout.js";

describe(
  "Input layout regression",
  () => {
    it(
      "keeps an empty input at one line even when placeholder scrollHeight is large",
      () => {
        const layout =
          calculateInputHeights({
            value: "",
            measuredScrollHeight:
              200,
            fontSize: 14,
            maxLines: 6
          });

        assert.equal(
          layout.contentHeight,
          layout.minTextareaHeight
        );

        assert.equal(
          layout.overflow,
          "hidden"
        );
      }
    );

    it(
      "clamps long input to maxLines",
      () => {
        const layout =
          calculateInputHeights({
            value:
              "a long value",
            measuredScrollHeight:
              1000,
            fontSize: 14,
            maxLines: 3
          });

        assert.equal(
          layout.contentHeight,
          layout.maxTextareaHeight
        );

        assert.equal(
          layout.overflow,
          "auto"
        );
      }
    );
  }
);
