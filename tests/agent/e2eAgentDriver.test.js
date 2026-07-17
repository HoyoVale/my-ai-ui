import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import {
  buildE2EResponse
} from "../../electron/agent/e2eAgentDriver.js";

describe(
  "E2E agent driver",
  () => {
    it(
      "encodes the number of user turns in its deterministic reply",
      () => {
        const result =
          buildE2EResponse([
            {
              role: "user",
              content:
                "first message"
            },
            {
              role: "assistant",
              content:
                "first reply"
            },
            {
              role: "user",
              content:
                "second message"
            }
          ]);

        assert.equal(
          result,
          "E2E_REPLY_2:second message"
        );
      }
    );


    it(
      "uses injected memory in the deterministic memory path",
      () => {
        const result =
          buildE2EResponse(
            [
              {
                role: "user",
                content: "memory-key"
              }
            ],
            [
              {
                content:
                  "memory-key 对应紫色彗星"
              }
            ]
          );

        assert.equal(
          result,
          "E2E_MEMORY:memory-key 对应紫色彗星"
        );
      }
    );
  }
);
