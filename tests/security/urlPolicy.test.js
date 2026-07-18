import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import {
  isLocalOrPrivateHost,
  parseSafeExternalUrl
} from "../../electron/security/urlPolicy.js";

describe(
  "external URL policy",
  () => {
    it(
      "allows ordinary public http and https links",
      () => {
        assert.equal(
          parseSafeExternalUrl(
            "https://example.com/docs"
          )?.hostname,
          "example.com"
        );

        assert.equal(
          parseSafeExternalUrl(
            "http://example.org"
          )?.protocol,
          "http:"
        );
      }
    );

    it(
      "blocks custom protocols, embedded credentials and private hosts",
      () => {
        for (
          const value
          of [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "https://user:pass@example.com",
            "http://localhost:11434/api",
            "http://127.0.0.1:3000",
            "http://192.168.1.1",
            "http://[::1]/"
          ]
        ) {
          assert.equal(
            parseSafeExternalUrl(
              value
            ),
            null,
            value
          );
        }
      }
    );

    it(
      "recognizes private and local host names",
      () => {
        assert.equal(
          isLocalOrPrivateHost(
            "10.0.0.2"
          ),
          true
        );
        assert.equal(
          isLocalOrPrivateHost(
            "service.local"
          ),
          true
        );
        assert.equal(
          isLocalOrPrivateHost(
            "example.com"
          ),
          false
        );
      }
    );
  }
);
