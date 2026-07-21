import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import fs from "node:fs";

import {
  resolveResponsePresentation
} from "../../src/Response/utils/responsePresentation.js";

function read(relativePath) {
  return fs.readFileSync(
    new URL(
      relativePath,
      import.meta.url
    ),
    "utf8"
  );
}

describe(
  "Response rendering recovery",
  () => {
    it(
      "does not mount a React portal inside ReactMarkdown output",
      () => {
        const source = read(
          "../../src/Response/components/StreamingMarkdown.jsx"
        );

        assert.doesNotMatch(
          source,
          /createPortal/u
        );

        assert.match(
          source,
          /host\.appendChild/u
        );

        assert.match(
          source,
          /cursorElement\.remove/u
        );
      }
    );

    it(
      "keeps tool-run text visible while the structured snapshot is delayed",
      () => {
        assert.deepEqual(
          resolveResponsePresentation({
            text: "正在读取项目文件",
            finalText: "",
            liveStepText: "",
            hasActivity: true,
            streaming: true
          }),
          {
            answerText: "",
            liveText:
              "正在读取项目文件"
          }
        );
      }
    );

    it(
      "renders an after-tool final candidate directly in the answer area while it streams",
      () => {
        assert.deepEqual(
          resolveResponsePresentation({
            text: "先前工具说明最终回",
            finalText: "",
            liveStepText: "最终回",
            liveStepRole: "final_candidate",
            hasActivity: true,
            streaming: true
          }),
          {
            answerText: "最终回",
            liveText: ""
          }
        );
      }
    );

    it(
      "falls back to the completed text stream when finalText is missing",
      () => {
        assert.deepEqual(
          resolveResponsePresentation({
            text: "最终回复",
            finalText: "",
            liveStepText: "",
            hasActivity: true,
            streaming: false
          }),
          {
            answerText: "最终回复",
            liveText: ""
          }
        );
      }
    );
  }
);
