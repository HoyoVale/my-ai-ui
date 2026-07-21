import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import { builtinCapabilityMap } from "../../electron/tools/capabilities/CapabilityMapping.js";
import { createWorkspaceToolDefinitions } from "../../electron/tools/workspace/workspaceTools.js";
import { createWorkspaceWriteToolDefinitions } from "../../electron/tools/workspace/workspaceWriteTools.js";

describe("Tool V3 and Diff UI contract", () => {
  it("publishes compare and destructive delete capabilities", () => {
    const capabilities = builtinCapabilityMap();
    assert.deepEqual(capabilities.compare_files, ["workspace.file.compare"]);
    assert.deepEqual(capabilities.delete_path, ["workspace.file.delete"]);
    assert.equal(
      createWorkspaceToolDefinitions({ roots: [process.cwd()] })
        .some((tool) => tool.name === "compare_files"),
      true
    );
    const deletion = createWorkspaceWriteToolDefinitions({ roots: [process.cwd()] })
      .find((tool) => tool.name === "delete_path");
    assert.equal(deletion.runtimeContract.effect, "destructive");
    assert.equal(deletion.riskLevel, "high");
  });

  it("keeps the Skill badge inside the left topbar group", () => {
    const source = fs.readFileSync("src/Conversation/components/Topbar.jsx", "utf8");
    const leftStart = source.indexOf('className="conversation-topbar__left"');
    const skill = source.indexOf('className="conversation-topbar__skill"');
    const leftClose = source.indexOf('</div>\n\n      <div className="conversation-topbar__right">');
    assert.equal(leftStart >= 0, true);
    assert.equal(skill > leftStart, true);
    assert.equal(skill < leftClose, true);
  });

  it("renders structured Diff rows with two line-number columns", () => {
    const source = fs.readFileSync("src/Conversation/components/FileDiff.jsx", "utf8");
    const css = fs.readFileSync("src/Conversation/Conversation.css", "utf8");
    assert.match(source, /parseUnifiedDiff/u);
    assert.match(source, /oldNumber/u);
    assert.match(source, /newNumber/u);
    assert.match(css, /grid-template-columns:\s*42px 42px 18px/u);
    assert.match(css, /conversation-file-diff__summary-stats/u);
  });
});
