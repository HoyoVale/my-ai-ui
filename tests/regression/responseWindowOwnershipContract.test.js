import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  ownsResponseWindow
} from "../../electron/windows/response/responseWindowOwnership.js";

function read(relativePath) {
  return fs.readFileSync(
    new URL(`../../${relativePath}`, import.meta.url),
    "utf8"
  );
}

test("a stale Response close callback cannot release a replacement window", () => {
  const oldWindow = {};
  const replacementWindow = {};

  assert.equal(
    ownsResponseWindow(oldWindow, oldWindow),
    true
  );
  assert.equal(
    ownsResponseWindow(replacementWindow, oldWindow),
    false
  );
  assert.equal(
    ownsResponseWindow(replacementWindow, replacementWindow),
    true
  );
});

test("Response controller guards loading and close callbacks by window ownership", () => {
  const source = read(
    "electron/windows/response/ResponseWindowController.js"
  );

  assert.match(
    source,
    /const responseWindow\s*=\s*createBaseWindow/u
  );
  assert.match(
    source,
    /did-start-loading[\s\S]*ownsResponseWindow\([\s\S]*this\.window,[\s\S]*responseWindow/u
  );
  assert.match(
    source,
    /handleWindowClosed\(closedWindow\)[\s\S]*ownsResponseWindow\([\s\S]*this\.window,[\s\S]*closedWindow/u
  );
  assert.match(
    source,
    /attachToPet\(pet\)[\s\S]*this\.detachFromPet\(\)/u
  );
});
