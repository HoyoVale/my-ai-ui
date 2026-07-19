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

        assert.equal(
          layout.baseWindowHeight,
          52
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


    it(
      "uses the measured composer height without adding trailing transparent space",
      () => {
        const layout =
          calculateInputHeights({
            value: "two lines",
            measuredScrollHeight: 52,
            measuredBaseHeight: 82,
            fontSize: 14,
            maxLines: 6
          });

        assert.equal(
          layout.baseWindowHeight,
          82
        );

        assert.equal(
          layout.windowHeight,
          82
        );
      }
    );

    it(
      "reserves overlay space only while the compact context menu is open",
      () => {
        const closed = calculateInputHeights({
          value: "",
          measuredScrollHeight: 20,
          fontSize: 14,
          maxLines: 6,
          menuOpen: false
        });
        const open = calculateInputHeights({
          value: "",
          measuredScrollHeight: 20,
          fontSize: 14,
          maxLines: 6,
          menuOpen: true,
          menuHeight: 180
        });

        assert.equal(
          open.windowHeight - closed.windowHeight,
          190
        );
      }
    );
  }
);
