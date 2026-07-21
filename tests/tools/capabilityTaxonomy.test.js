import assert from "node:assert/strict";
import test from "node:test";

import {
  CAPABILITY_TAXONOMY_HASH,
  capabilityPermissionRequirements,
  createEnvironmentPermissionEnvelope,
  intersectPermissionEnvelopes,
  listCapabilityDefinitions,
  normalizeCapabilityIds,
  permissionDecisionForCapabilities
} from "../../electron/tools/capabilities/CapabilityTaxonomy.js";

import {
  inferToolCapabilities
} from "../../electron/tools/capabilities/CapabilityMapping.js";

test("capability taxonomy is unique, stable and covers the planned foundation", () => {
  const definitions = listCapabilityDefinitions();
  const ids = definitions.map((item) => item.id);

  assert.equal(new Set(ids).size, ids.length);
  assert.match(CAPABILITY_TAXONOMY_HASH, /^[a-f0-9]{20}$/u);
  for (const id of [
    "runtime.info",
    "workspace.file.read",
    "workspace.file.modify",
    "git.read.diff",
    "external.write",
    "agent.plan"
  ]) {
    assert.ok(ids.includes(id), `missing capability ${id}`);
  }
  assert.deepEqual(
    capabilityPermissionRequirements([
      "workspace.file.delete",
      "workspace.file.read"
    ]),
    ["destructive", "workspaceRead", "workspaceWrite"]
  );
});

test("permission envelopes use the most restrictive level", () => {
  const effective = intersectPermissionEnvelopes(
    { workspaceRead: "allow", workspaceWrite: "ask", network: "allow" },
    { workspaceRead: "ask", workspaceWrite: "deny", network: "allow" }
  );

  assert.equal(effective.workspaceRead, "ask");
  assert.equal(effective.workspaceWrite, "deny");
  assert.equal(effective.network, "allow");

  const decision = permissionDecisionForCapabilities(
    ["workspace.file.modify"],
    effective
  );
  assert.equal(decision.allowed, false);
  assert.deepEqual(decision.denied, ["workspaceWrite"]);
});

test("environment permissions keep Chat read-only and Coding writes approval-gated", () => {
  const chat = createEnvironmentPermissionEnvelope({
    mode: "chat",
    workspaceAvailable: true,
    processEnabled: true
  });
  const coding = createEnvironmentPermissionEnvelope({
    mode: "coding",
    workspaceAvailable: true,
    processEnabled: true,
    settings: {
      tools: {
        security: {
          approval: {
            localWrite: true,
            remoteWrite: true
          }
        }
      }
    }
  });

  assert.equal(chat.workspaceRead, "allow");
  assert.equal(chat.workspaceWrite, "deny");
  assert.equal(chat.process, "deny");
  assert.equal(coding.workspaceWrite, "ask");
  assert.equal(coding.process, "ask");
});

test("tool capability mapping separates built-in names from external providers", () => {
  const write = inferToolCapabilities({
    name: "apply_patch",
    source: "builtin.workspace",
    runtimeContract: { effect: "local_write" }
  });
  assert.deepEqual(write.capabilities, [
    "workspace.file.create",
    "workspace.file.modify"
  ]);

  const httpWrite = inferToolCapabilities({
    name: "custom_http_demo",
    source: "custom.http.demo",
    runtimeContract: { effect: "remote_write" }
  });
  assert.deepEqual(httpWrite.capabilities, ["external.write"]);
  assert.deepEqual(httpWrite.permissionRequirements, [
    "externalWrite",
    "network"
  ]);

  const mcpRead = inferToolCapabilities({
    name: "mcp_demo_read",
    source: "mcp.demo",
    runtimeContract: { effect: "read" },
    mcp: {
      annotations: {
        capabilities: ["network"]
      }
    }
  });
  assert.deepEqual(mcpRead.capabilities, ["external.read", "network.read"]);
});

test("unknown requested capability ids can be preserved for validation", () => {
  assert.deepEqual(
    normalizeCapabilityIds(
      ["workspace.file.read", "skill.future.capability"],
      { allowUnknown: true }
    ),
    ["skill.future.capability", "workspace.file.read"]
  );
});

test("explicit Tool capabilities fail closed when the taxonomy does not know them", () => {
  assert.throws(
    () => inferToolCapabilities({
      name: "future_tool",
      source: "plugin.future",
      capabilities: ["future.unknown"]
    }),
    /Unknown Tool capability/u
  );

  const pluginRead = inferToolCapabilities({
    name: "plugin_reader",
    source: "plugin.demo",
    runtimeContract: { effect: "read" }
  });
  assert.deepEqual(pluginRead.capabilities, ["external.read"]);
});
