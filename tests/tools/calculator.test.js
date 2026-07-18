import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import {
  evaluateExpression
} from "../../electron/tools/runtime/calculator.js";

describe(
  "safe calculator",
  () => {
    it(
      "evaluates arithmetic, powers, constants and functions",
      () => {
        assert.equal(
          evaluateExpression(
            "2 + 3 * 4"
          ),
          14
        );
        assert.equal(
          evaluateExpression(
            "sqrt(81) + pow(2, 3)"
          ),
          17
        );
        assert.equal(
          Math.round(
            evaluateExpression(
              "pi * 1000"
            )
          ),
          3142
        );
      }
    );

    it(
      "rejects unsupported input and division by zero",
      () => {
        assert.throws(
          () =>
            evaluateExpression(
              "process.exit()"
            ),
          /不支持/u
        );
        assert.throws(
          () =>
            evaluateExpression(
              "1 / 0"
            ),
          /除以零/u
        );
      }
    );
  }
);
