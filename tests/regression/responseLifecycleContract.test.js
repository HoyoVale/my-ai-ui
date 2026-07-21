import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import fs from "node:fs";

describe(
  "Response lifecycle regression",
  () => {
    it(
      "resets dismissal and actively reveals the next streamed reply",
      () => {
        const source =
          fs.readFileSync(
            new URL(
              "../../electron/windows/response/ResponseWindowController.js",
              import.meta.url
            ),
            "utf8"
          );

        assert.match(
          source,
          /this\.dismissed\s*=\s*false/
        );

        assert.match(
          source,
          /appendChunk[\s\S]*revealForStream\(\)/
        );
      }
    );

    it(
      "waits for the Response renderer subscription handshake before flushing queued chunks",
      () => {
        const controllerSource =
          fs.readFileSync(
            new URL(
              "../../electron/windows/response/ResponseWindowController.js",
              import.meta.url
            ),
            "utf8"
          );

        const hookSource =
          fs.readFileSync(
            new URL(
              "../../src/Response/hooks/useResponseStream.js",
              import.meta.url
            ),
            "utf8"
          );

        assert.match(
          controllerSource,
          /markRendererReady\(\)[\s\S]*this\.ready\s*=\s*true[\s\S]*this\.flushPendingMessages\(\)/u
        );

        assert.doesNotMatch(
          controllerSource,
          /did-finish-load[\s\S]{0,400}flushPendingMessages\(\)/u
        );

        assert.match(
          hookSource,
          /offSide[\s\S]*notifyResponseReady\?\.\(\)[\s\S]*return\s*\(\)\s*=>/u
        );
      }
    );
  }
);
