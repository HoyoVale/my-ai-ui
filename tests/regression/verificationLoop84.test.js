import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("84 keeps failure classification, independent replanning and evidence-bound completion wired", () => {
  const kernel = read("electron/platform/PlatformKernel.js");
  const scheduler = read("electron/platform/PlatformJobScheduler.js");
  const platform = read("electron/platform/index.js");
  const dock = read("src/Conversation/components/PlatformDock.jsx");
  const documentation = read("docs/VERIFICATION_LOOP_84.md");

  assert.match(kernel, /EVIDENCE_BOUND/u);
  assert.match(kernel, /platform-criterion-evidence-required/u);
  assert.match(kernel, /artifactManifestHash/u);
  assert.match(kernel, /completion-signature-superseded/u);
  assert.match(scheduler, /onFailure/u);
  assert.match(platform, /IndependentReplanner/u);
  assert.match(platform, /classifyPlatformFailure/u);
  assert.match(dock, /Artifacts \/ Logs · Evidence/u);
  assert.match(documentation, /Completion Authority/u);
});
