import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import {
  assembleAgentContext
} from "../../electron/context/ContextAssembler.js";

const SETTINGS = {
  personality: {
    enabled: true,
    name: "Nova",
    identity: "桌面研究助手",
    language: "zh-CN",
    tone: "professional",
    responseLength:
      "balanced",
    customInstructions:
      "优先保持结构清楚。"
  },
  conversation: {
    contextTurns: 1
  },
  memory: {
    enabled: true
  }
};

describe(
  "ContextAssembler",
  () => {
    it(
      "assembles base rules, personality and memory in a stable order",
      () => {
        const result =
          assembleAgentContext({
            settings: SETTINGS,
            conversation: {
              messages: [
                {
                  role: "user",
                  content: "old",
                  status: "complete"
                },
                {
                  role: "assistant",
                  content: "old reply",
                  status: "complete"
                },
                {
                  role: "user",
                  content: "latest",
                  status: "complete"
                }
              ]
            },
            memories: [
              {
                title: "环境",
                content:
                  "用户使用 Windows。"
              }
            ]
          });

        const baseIndex =
          result.system.indexOf(
            "运行在用户桌面"
          );
        const runtimeIndex =
          result.system.indexOf(
            "当前运行环境"
          );
        const personalityIndex =
          result.system.indexOf(
            "名称：Nova"
          );
        const memoryIndex =
          result.system.indexOf(
            "用户使用 Windows"
          );

        assert.equal(
          baseIndex >= 0,
          true
        );
        assert.equal(
          runtimeIndex >
            baseIndex,
          true
        );
        assert.equal(
          personalityIndex >
            runtimeIndex,
          true
        );
        assert.equal(
          memoryIndex >
            personalityIndex,
          true
        );

        assert.deepEqual(
          result.messages,
          [
            {
              role: "user",
              content: "latest"
            }
          ]
        );

        assert.equal(
          result.metadata
            .memoryCount,
          1
        );
        assert.equal(
          result.metadata
            .personality
            .name,
          "Nova"
        );
        assert.equal(
          result.metadata
            .runtime
            .toolProfile,
          "workspace"
        );
        assert.equal(
          result.budget.sections
            .some(
              (section) =>
                section.id ===
                "runtime"
            ),
          true
        );
      }
    );

    it(
      "omits disabled personality and memory context",
      () => {
        const result =
          assembleAgentContext({
            settings: {
              ...SETTINGS,
              personality: {
                ...SETTINGS.personality,
                enabled: false
              },
              memory: {
                enabled: false
              }
            },
            conversation: {
              messages: []
            },
            memories: [
              {
                title: "secret",
                content: "hidden"
              }
            ]
          });

        assert.equal(
          result.system.includes(
            "名称：Nova"
          ),
          false
        );
        assert.equal(
          result.system.includes(
            "hidden"
          ),
          false
        );
        assert.equal(
          result.metadata
            .memoryCount,
          0
        );
      }
    );
  }
);

describe(
  "ContextAssembler budget and managed context",
  () => {
    it(
      "includes pinned messages in system context with a token breakdown",
      () => {
        const result =
          assembleAgentContext({
            settings: {
              ...SETTINGS,
              conversation: {
                contextTurns: 2,
                contextTokenBudget: 64000
              },
              model: {
                maxOutputTokens: 2048
              }
            },
            conversation: {
              contextStartAfterMessageId:
                "old-answer",
              messages: [
                {
                  id: "pinned",
                  role: "user",
                  content: "pinned rule",
                  status: "complete",
                  includeInContext: true,
                  pinnedToContext: true
                },
                {
                  id: "old-answer",
                  role: "assistant",
                  content: "old",
                  status: "complete",
                  includeInContext: true
                },
                {
                  id: "latest",
                  role: "user",
                  content: "latest",
                  status: "complete",
                  includeInContext: true
                }
              ]
            },
            memories: []
          });

        assert.match(
          result.system,
          /pinned rule/
        );
        assert.deepEqual(
          result.messages,
          [
            {
              role: "user",
              content: "latest"
            }
          ]
        );
        assert.equal(
          result.metadata
            .pinnedMessageCount,
          1
        );
      }
    );
  }
);
