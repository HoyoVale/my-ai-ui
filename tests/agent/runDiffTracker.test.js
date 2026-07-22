import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { RunDiffTracker } from "../../electron/agent/RunDiffTracker.js";

describe("RunDiffTracker", () => {
  it("collapses repeated writes into one baseline-to-final file diff", () => {
    const tracker = new RunDiffTracker({ runId: "run-1", workspaceId: "workspace-1" });
    tracker.record({
      kind: "modify",
      path: "src/app.js",
      beforeText: "const value = 1;\n",
      afterText: "const value = 2;\n",
      beforeBytes: 17,
      afterBytes: 17
    });
    tracker.record({
      kind: "modify",
      path: "src/app.js",
      beforeText: "const value = 2;\n",
      afterText: "const value = 3;\n",
      beforeBytes: 17,
      afterBytes: 17
    });

    const snapshot = tracker.snapshot();
    assert.equal(snapshot.files.length, 1);
    assert.equal(snapshot.files[0].path, "src/app.js");
    assert.match(snapshot.files[0].diff, /-const value = 1;/u);
    assert.match(snapshot.files[0].diff, /\+const value = 3;/u);
    assert.doesNotMatch(snapshot.files[0].diff, /\+const value = 2;/u);
    assert.equal(snapshot.totals.files, 1);
    assert.equal(snapshot.totals.added, 1);
    assert.equal(snapshot.totals.removed, 1);
  });

  it("reports added, deleted, renamed and binary files without duplicates", () => {
    const tracker = new RunDiffTracker({ runId: "run-2" });
    tracker.record({ kind: "add", path: "new.txt", beforeExists: false, afterText: "new\n" });
    tracker.record({ kind: "delete", path: "old.txt", beforeText: "old\n", beforeBytes: 4 });
    tracker.record({
      kind: "rename",
      source: "before.js",
      path: "after.js",
      beforeText: "export const value = 1;\n",
      afterText: "export const value = 1;\n"
    });
    tracker.record({
      kind: "modify",
      path: "image.png",
      binary: true,
      beforeBytes: 10,
      afterBytes: 20,
      beforeSha256: "a",
      afterSha256: "b"
    });

    const snapshot = tracker.snapshot();
    const byPath = Object.fromEntries(snapshot.files.map((file) => [file.path, file]));
    assert.equal(byPath["new.txt"].status, "added");
    assert.equal(byPath["old.txt"].status, "deleted");
    assert.equal(byPath["after.js"].status, "renamed");
    assert.equal(byPath["after.js"].oldPath, "before.js");
    assert.equal(byPath["image.png"].status, "binary_modified");
    assert.equal(snapshot.totals.renamedFiles, 1);
    assert.equal(snapshot.totals.binaryFiles, 1);
  });
});
