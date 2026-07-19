import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import {
  isActivityEventVisible
} from "../../src/Conversation/utils/taskActivity.js";

describe(
  "activity visibility",
  () => {
    it(
      "keeps the Tool flow visible outside developer mode",
      () => {
        assert.equal(
          isActivityEventVisible({
            type: "tool",
            activityVisibility: "developer",
            tool: {
              name: "calculator",
              activityVisibility: "developer"
            }
          }),
          true
        );

        assert.equal(
          isActivityEventVisible({
            type: "commentary",
            activityVisibility: "developer",
            content: "正在检查项目"
          }),
          true
        );
      }
    );

    it(
      "keeps runtime diagnostics developer-only",
      () => {
        const event = {
          type: "status",
          status: "running",
          activityVisibility: "developer"
        };

        assert.equal(
          isActivityEventVisible(event),
          false
        );

        assert.equal(
          isActivityEventVisible(
            event,
            {
              developerMode: true
            }
          ),
          true
        );
      }
    );
  }
);
