import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import {
  buildE2EResponse,
  getE2EToolWriteRequest
} from "../../electron/agent/e2eAgentDriver.js";

describe(
  "E2E agent driver",
  () => {

    it(
      "recognizes the deterministic approved write request",
      () => {
        const result =
          getE2EToolWriteRequest([
            {
              role: "assistant",
              content: "ready"
            },
            {
              role: "user",
              content: "tool-write-key"
            }
          ]);

        assert.deepEqual(
          result,
          {
            path: "e2e-approved.txt",
            content: "E2E approved write\n"
          }
        );

        assert.equal(
          getE2EToolWriteRequest([
            {
              role: "user",
              content: "ordinary request"
            }
          ]),
          null
        );
      }
    );

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

        assert.match(
          result,
          /^E2E_REPLY_2:second message/u
        );
        assert.match(
          result,
          /```js/u
        );
        assert.match(
          result,
          /\| 项目 \| 状态 \|/u
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


    it(
      "uses assembled personality metadata in the deterministic personality path",
      () => {
        const result =
          buildE2EResponse(
            [
              {
                role: "user",
                content:
                  "personality-key"
              }
            ],
            [],
            {
              personality: {
                enabled: true,
                name: "Nova",
                tone: "professional",
                responseLength:
                  "detailed"
              }
            }
          );

        assert.equal(
          result,
          "E2E_PERSONALITY:Nova:professional:detailed"
        );
      }
    );

    it(
      "reports the active model metadata",
      () => {
        const result =
          buildE2EResponse(
            [
              {
                role: "user",
                content: "model-key"
              }
            ],
            [],
            {
              activeModel: {
                modelName: "E2E Model",
                modelId: "e2e-model",
                contextTokenBudget: 128000
              }
            }
          );

        assert.equal(
          result,
          "E2E_MODEL:E2E Model:e2e-model:128000"
        );
      }
    );

    it(
      "returns inline and display LaTeX for renderer coverage",
      () => {
        const result =
          buildE2EResponse([
            {
              role: "user",
              content: "latex-key"
            }
          ]);

        assert.match(
          result,
          /\$E = mc\^2\$/u
        );
        assert.match(
          result,
          /\$\$[\s\S]*\\frac\{1\}\{3\}[\s\S]*\$\$/u
        );
      }
    );

    it(
      "marks deterministic regeneration runs",
      () => {
        const result =
          buildE2EResponse(
            [
              {
                role: "user",
                content: "second message"
              }
            ],
            [],
            {
              regeneration: true
            }
          );

        assert.equal(
          result,
          "E2E_REGENERATED_1:second message"
        );
      }
    );

  }
);
