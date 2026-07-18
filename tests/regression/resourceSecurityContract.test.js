import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import fs from "node:fs";

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
  "external resource security contract",
  () => {
    it(
      "renders remote Markdown images as placeholders instead of img elements",
      () => {
        const markdown =
          read(
            "../../src/Conversation/components/MarkdownContent.jsx"
          );
        const resources =
          read(
            "../../src/shared/security/MarkdownResources.jsx"
          );

        assert.match(
          markdown,
          /SafeMarkdownImage/u
        );
        assert.match(
          markdown,
          /skipHtml/u
        );
        assert.match(
          resources,
          /外部图片已阻止/u
        );
        assert.match(
          resources,
          /openExternalLink/u
        );
      }
    );

    it(
      "blocks unexpected renderer navigation, windows and network requests",
      () => {
        const source =
          read(
            "../../electron/security/rendererSecurity.js"
          );

        assert.match(
          source,
          /will-navigate/u
        );
        assert.match(
          source,
          /setWindowOpenHandler/u
        );
        assert.match(
          source,
          /onBeforeRequest/u
        );
        assert.match(
          source,
          /setPermissionRequestHandler/u
        );
      }
    );

    it(
      "defines a restrictive renderer CSP",
      () => {
        const source =
          read(
            "../../index.html"
          );

        assert.match(
          source,
          /Content-Security-Policy/u
        );
        assert.match(
          source,
          /object-src 'none'/u
        );
        assert.match(
          source,
          /frame-src 'none'/u
        );
      }
    );
  }
);
