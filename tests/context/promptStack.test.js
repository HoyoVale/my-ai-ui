import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  assembleAgentContext
} from "../../electron/context/ContextAssembler.js";

import {
  DEFAULT_MODE_CONTEXTS
} from "../../electron/context/baseSystemContext.js";

const BASE_SETTINGS = {
  general: { developerMode: true },
  tools: {
    enabled: true,
    mode: "coding",
    workspace: { roots: [] },
    developer: {
      toolsetOverrides: {},
      toolOverrides: {}
    }
  },
  prompts: {
    modeOverrides: {
      chat: "",
      coding: ""
    },
    developerInstructions: ""
  },
  personality: {
    enabled: true,
    name: "Nova",
    identity: "助手",
    language: "auto",
    tone: "natural",
    responseLength: "balanced",
    customInstructions: ""
  },
  memory: { enabled: false },
  conversation: { contextTurns: 8 }
};

describe("Prompt Stack", () => {
  it("keeps the Runtime Kernel and product policy immutable", () => {
    const result = assembleAgentContext({
      settings: BASE_SETTINGS,
      conversation: { messages: [] },
      memories: []
    });
    const kernel = result.promptSections.find((section) => section.id === "runtime-kernel");
    const product = result.promptSections.find((section) => section.id === "product-base");
    const mode = result.promptSections.find((section) => section.id === "mode-coding");

    assert.equal(kernel.locked, true);
    assert.equal(kernel.editable, false);
    assert.equal(product.locked, true);
    assert.equal(product.editable, false);
    assert.equal(mode.locked, false);
    assert.equal(mode.editable, true);
    assert.match(mode.content, /修改代码前先检查/u);
  });

  it("uses a developer mode override without replacing the safety kernel", () => {
    const custom = "所有代码修改都先运行最相关的测试。";
    const result = assembleAgentContext({
      settings: {
        ...BASE_SETTINGS,
        prompts: {
          modeOverrides: {
            chat: "",
            coding: custom
          },
          developerInstructions: "输出中注明验证范围。"
        }
      },
      conversation: { messages: [] },
      memories: []
    });

    const mode = result.promptSections.find((section) => section.id === "mode-coding");
    const developer = result.promptSections.find((section) => section.id === "developer-instructions");

    assert.equal(mode.source, "developer-settings");
    assert.equal(mode.content, custom);
    assert.equal(developer.authority, "developer");
    assert.equal(developer.editable, true);
    assert.match(result.system, /不得伪造工具调用/u);
    assert.match(result.system, /输出中注明验证范围/u);
    assert.equal(result.system.includes(DEFAULT_MODE_CONTEXTS.coding), false);
  });

  it("declares unavailable capabilities instead of implying them", () => {
    const result = assembleAgentContext({
      settings: {
        ...BASE_SETTINGS,
        tools: {
          ...BASE_SETTINGS.tools,
          mode: "chat"
        }
      },
      conversation: { messages: [] },
      memories: [],
      toolManifest: []
    });

    const capabilities = result.promptSections.find((section) => section.id === "capabilities");
    assert.match(capabilities.content, /没有工作区写入能力/u);
    assert.match(capabilities.content, /没有任意网络访问或外部平台能力/u);
    assert.match(capabilities.content, /没有浏览器自动化能力/u);
  });
});
