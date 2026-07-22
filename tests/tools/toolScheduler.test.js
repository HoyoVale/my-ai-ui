import assert from "node:assert/strict";
import { it } from "node:test";

import {
  ToolScheduler,
  resolveToolSchedulerPolicy
} from "../../electron/tools/core/ToolScheduler.js";

function definition(name) {
  return { name };
}

it("allows shared reads and disjoint path writes while blocking same-path read/write", async () => {
  const scheduler = new ToolScheduler({
    maxConcurrent: 4,
    context: { workspaceId: "workspace-1", taskId: "task-1" }
  });
  const releaseRead = await scheduler.acquire(
    definition("read_text_file"),
    { path: "src/a.js" }
  );
  const releaseOtherWrite = await scheduler.acquire(
    definition("write_text_file"),
    { path: "src/b.js" }
  );

  let sameWriteStarted = false;
  const sameWrite = scheduler.acquire(
    definition("write_text_file"),
    { path: "src/a.js" }
  ).then((release) => {
    sameWriteStarted = true;
    return release;
  });
  await Promise.resolve();
  assert.equal(sameWriteStarted, false);

  releaseRead();
  const releaseSameWrite = await sameWrite;
  assert.equal(sameWriteStarted, true);
  releaseSameWrite();
  releaseOtherWrite();
});

it("treats parent and child paths as conflicting resources", async () => {
  const scheduler = new ToolScheduler({
    context: { workspaceId: "workspace-1" }
  });
  const releaseParent = await scheduler.acquire(
    definition("delete_path"),
    { path: "src" }
  );
  let childStarted = false;
  const child = scheduler.acquire(
    definition("read_text_file"),
    { path: "src/a.js" }
  ).then((release) => {
    childStarted = true;
    return release;
  });
  await Promise.resolve();
  assert.equal(childStarted, false);
  releaseParent();
  const releaseChild = await child;
  assert.equal(childStarted, true);
  releaseChild();
});

it("uses Plan and whole-workspace mutations as queue barriers", async () => {
  const scheduler = new ToolScheduler({
    context: { workspaceId: "workspace-1", taskId: "task-1" }
  });
  const releaseRead = await scheduler.acquire(
    definition("read_text_file"),
    { path: "src/a.js" }
  );
  const order = [];
  const plan = scheduler.acquire(
    definition("update_plan"),
    { items: [] }
  ).then((release) => {
    order.push("plan");
    return release;
  });
  const laterRead = scheduler.acquire(
    definition("read_text_file"),
    { path: "src/b.js" }
  ).then((release) => {
    order.push("read");
    return release;
  });
  releaseRead();
  const releasePlan = await plan;
  assert.deepEqual(order, ["plan"]);
  releasePlan();
  const releaseLater = await laterRead;
  assert.deepEqual(order, ["plan", "read"]);
  releaseLater();

  const patchPolicy = resolveToolSchedulerPolicy(
    definition("apply_patch"),
    { patch: "--- a/a\n+++ b/a" },
    { workspaceId: "workspace-1" }
  );
  assert.equal(patchPolicy.barrier, true);
  assert.equal(patchPolicy.resources[0].mode, "exclusive");
});

it("preserves legacy exclusiveConcurrency as a global queue barrier", async () => {
  const scheduler = new ToolScheduler({ maxConcurrent: 3, context: { workspaceId: "ws" } });
  const ordinary = { name: "get_runtime_info" };
  const exclusive = { name: "legacy_control", exclusiveConcurrency: true };

  const releaseFirst = await scheduler.acquire(ordinary, {});
  let exclusiveStarted = false;
  const exclusivePromise = scheduler.acquire(exclusive, {}).then((release) => {
    exclusiveStarted = true;
    return release;
  });
  let laterStarted = false;
  const laterPromise = scheduler.acquire(ordinary, {}).then((release) => {
    laterStarted = true;
    return release;
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(exclusiveStarted, false);
  assert.equal(laterStarted, false);

  releaseFirst();
  const releaseExclusive = await exclusivePromise;
  assert.equal(exclusiveStarted, true);
  assert.equal(laterStarted, false);
  releaseExclusive();
  const releaseLater = await laterPromise;
  assert.equal(laterStarted, true);
  releaseLater();
});

it("folds Windows path case so aliases cannot bypass one file lock", () => {
  const upper = resolveToolSchedulerPolicy(
    definition("write_text_file"),
    { path: "SRC\\Scene.js" },
    { workspaceId: "workspace-1", platform: "win32" }
  );
  const lower = resolveToolSchedulerPolicy(
    definition("read_text_file"),
    { path: "src/scene.js" },
    { workspaceId: "workspace-1", platform: "win32" }
  );
  assert.equal(upper.resources[0].key, lower.resources[0].key);
  assert.equal(upper.resources[0].mode, "exclusive");
  assert.equal(lower.resources[0].mode, "shared");
});
