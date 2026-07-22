import {
  readConversationMessageSource
} from "../helpers/conversationUiSource.js";

import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";
import fs from "node:fs";

import {
  readAgentRuntimeSource
} from "../helpers/agentRuntimeSource.js";

function read(relativePath) {
  return fs.readFileSync(
    new URL(relativePath, import.meta.url),
    "utf8"
  );
}

describe("live Tool activity rendering", () => {
  it("tracks live event revisions instead of waiting for a persisted message", () => {
    const source = readConversationMessageSource();

    assert.match(source, /liveRevision/u);
    assert.match(source, /liveActivity\?\.activity\?\.events/u);
    assert.match(source, /lastEvent\?\.updatedAt/u);
    assert.match(source, /conversation\?\.messages\.length,[\s\S]*liveRevision/u);
  });

  it("follows the live run only while the reader remains near the bottom", () => {
    const source = readConversationMessageSource();

    assert.match(source, /followLiveRef/u);
    assert.match(source, /remaining < 140/u);
    assert.match(source, /scrollIntoView/u);
  });

  it("publishes streamed text revisions through Agent status", () => {
    const source = readAgentRuntimeSource();

    assert.match(source, /assistantText:[\s\S]*this\.activeRun/u);
    assert.match(source, /appendResponseChunk\([\s\S]*this\.setStatus/u);
  });
});
