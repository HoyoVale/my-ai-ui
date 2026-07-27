import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { verifyCoreLiteTree } from "../../scripts/verify-core-lite-tree.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("Core Lite 3.6 P0 rejects retired runtime files and generated artifacts", () => {
  const result = verifyCoreLiteTree();
  assert.deepEqual(result, { ok: true, errors: [] });
});

test("Core Lite 3.6 P0 E2E verifies /goal removal through a supported command", () => {
  const source = read("tests/e2e/conversation-flow.cjs");
  const retiredGoalCommandSelector = ["input", "slash", "command", "goal"].join("-");
  assert.equal(source.includes(retiredGoalCommandSelector), false);
  assert.equal(source.includes('includes("/goal")'), true);
  assert.equal(source.includes('input-slash-command-model'), true);
  const retiredGoalCriteriaSelector = ["input", "goal", "criteria"].join("-");
  assert.equal(source.includes(retiredGoalCriteriaSelector), false);
});

test("Core Lite 3.6 P0 runs tree verification before normal checks", () => {
  const packageJson = JSON.parse(read("package.json"));
  assert.match(packageJson.scripts.check, /^npm run verify:core-lite-tree &&/u);
  assert.equal(packageJson.scripts["verify:core-lite-tree"], "node scripts/verify-core-lite-tree.mjs");
  assert.equal(packageJson.scripts["archive:source"], "node scripts/create-source-archive.mjs");
});

test("Core Lite 3.6 P0 source archiver stages a fresh tree and verifies extraction", () => {
  const source = read("scripts/create-source-archive.mjs");
  assert.match(source, /mkdtempSync/u);
  assert.match(source, /rmSync\(outputPath, \{ force: true \}\)/u);
  assert.match(source, /extractStoredZip/u);
  assert.match(source, /assertEqualTrees/u);
  assert.match(source, /"node_modules"/u);
  assert.match(source, /"test-results"/u);
  assert.match(source, /"\.env"/u);
});
