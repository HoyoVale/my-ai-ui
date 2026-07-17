import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import {
  buildPersonalityContext,
  getPersonalitySummary
} from "../../electron/context/personalityContextBuilder.js";

describe(
  "personality context builder",
  () => {
    it(
      "returns no personality context when disabled",
      () => {
        assert.equal(
          buildPersonalityContext({
            enabled: false,
            name: "Nova"
          }),
          ""
        );
      }
    );

    it(
      "renders identity, tone, language, length and custom instructions",
      () => {
        const result =
          buildPersonalityContext({
            enabled: true,
            name: "Nova",
            identity:
              "桌面研究助手",
            language: "zh-CN",
            tone: "professional",
            responseLength:
              "detailed",
            customInstructions:
              "先给结论，再给证据。"
          });

        assert.match(
          result,
          /名称：Nova/
        );
        assert.match(
          result,
          /身份：桌面研究助手/
        );
        assert.match(
          result,
          /简体中文/
        );
        assert.match(
          result,
          /专业/
        );
        assert.match(
          result,
          /更完整/
        );
        assert.match(
          result,
          /先给结论，再给证据/
        );
      }
    );

    it(
      "returns stable personality metadata",
      () => {
        assert.deepEqual(
          getPersonalitySummary({
            enabled: true,
            name: "Nova",
            identity: "助手",
            language: "auto",
            tone: "direct",
            responseLength:
              "concise"
          }),
          {
            enabled: true,
            name: "Nova",
            identity: "助手",
            language: "auto",
            tone: "direct",
            responseLength:
              "concise"
          }
        );
      }
    );
  }
);
