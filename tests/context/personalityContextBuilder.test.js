import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  buildPersonalityContext,
  getPersonalitySummary
} from "../../electron/context/personalityContextBuilder.js";

describe(
  "personality context builder",
  () => {
    it("returns no personality context when disabled", () => {
      assert.equal(
        buildPersonalityContext({ enabled: false, name: "Nova" }),
        ""
      );
    });

    it("renders identity, free-form response preferences and custom instructions", () => {
      const result = buildPersonalityContext({
        enabled: true,
        name: "Nova",
        identity: "桌面研究助手",
        responsePreferences: "根据用户当前语言回复；先给结论，复杂问题提供完整证据。",
        customInstructions: "引用文件时说明路径。"
      });

      assert.match(result, /名称：Nova/u);
      assert.match(result, /身份：桌面研究助手/u);
      assert.match(result, /根据用户当前语言回复/u);
      assert.match(result, /完整证据/u);
      assert.match(result, /引用文件时说明路径/u);
    });

    it("migrates the legacy fixed choices into one response preference", () => {
      const result = buildPersonalityContext({
        enabled: true,
        language: "zh-CN",
        tone: "professional",
        responseLength: "detailed"
      });
      assert.match(result, /默认使用简体中文/u);
      assert.match(result, /语气专业/u);
      assert.match(result, /完整细节/u);
    });

    it("returns stable personality metadata", () => {
      assert.deepEqual(
        getPersonalitySummary({
          enabled: true,
          name: "Nova",
          identity: "助手",
          responsePreferences: "跟随用户语言，直接回答。"
        }),
        {
          enabled: true,
          name: "Nova",
          identity: "助手",
          responsePreferences: "跟随用户语言，直接回答。",
          language: "auto",
          tone: "natural",
          responseLength: "balanced"
        }
      );
    });
  }
);
