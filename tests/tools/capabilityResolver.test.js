import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveCapabilitySet
} from "../../electron/tools/capabilities/CapabilityResolver.js";

function tool({
  name,
  capabilities,
  source = "builtin.test",
  sourceKind = "builtin",
  permissionRequirements = []
}) {
  return {
    id: `${source}.${name}@1`,
    name,
    title: name,
    source,
    sourceKind,
    capabilities,
    permissionRequirements,
    ready: true,
    available: true,
    effectiveEnabled: true
  };
}

test("resolver satisfies read capabilities in Chat but rejects local writes", () => {
  const tools = [
    tool({ name: "read", capabilities: ["workspace.file.read"] }),
    tool({ name: "write", capabilities: ["workspace.file.modify"] })
  ];
  const read = resolveCapabilitySet({
    tools,
    mode: "chat",
    workspaceAvailable: true,
    request: { requiredCapabilities: ["workspace.file.read"] }
  });
  assert.equal(read.satisfied, true);
  assert.deepEqual(read.selectedToolNames, ["read"]);

  const write = resolveCapabilitySet({
    tools,
    mode: "chat",
    workspaceAvailable: true,
    request: { requiredCapabilities: ["workspace.file.modify"] }
  });
  assert.equal(write.satisfied, false);
  assert.deepEqual(write.missingRequired, ["workspace.file.modify"]);
  assert.equal(write.toolDecisions.write.allowed, false);
});

test("Coding resolves local write as approval-gated and prefers built-in providers", () => {
  const resolution = resolveCapabilitySet({
    tools: [
      tool({
        name: "mcp_reader",
        capabilities: ["workspace.file.read"],
        source: "mcp.files",
        sourceKind: "mcp"
      }),
      tool({
        name: "builtin_reader",
        capabilities: ["workspace.file.read"]
      }),
      tool({
        name: "writer",
        capabilities: ["workspace.file.modify"]
      })
    ],
    mode: "coding",
    workspaceAvailable: true,
    request: {
      requiredCapabilities: [
        "workspace.file.read",
        "workspace.file.modify"
      ]
    }
  });

  assert.equal(resolution.satisfied, true);
  assert.deepEqual(resolution.selectedToolNames, ["builtin_reader", "writer"]);
  assert.equal(resolution.toolDecisions.writer.requiresApproval, true);
  const readCapability = resolution.capabilities.find(
    (item) => item.id === "workspace.file.read"
  );
  assert.equal(readCapability.selectedProvider.name, "builtin_reader");
});

test("requested permission envelope can only reduce available capabilities", () => {
  const resolution = resolveCapabilitySet({
    tools: [tool({ name: "writer", capabilities: ["external.write"] })],
    mode: "coding",
    workspaceAvailable: true,
    request: {
      requiredCapabilities: ["external.write"],
      permissions: { externalWrite: "deny" }
    }
  });

  assert.equal(resolution.satisfied, false);
  assert.equal(resolution.permissions.environment.externalWrite, "ask");
  assert.equal(resolution.permissions.requested.externalWrite, "deny");
  assert.equal(resolution.permissions.effective.externalWrite, "deny");
});

test("unknown required capabilities remain visible as missing", () => {
  const resolution = resolveCapabilitySet({
    tools: [],
    request: {
      requiredCapabilities: ["skill.unknown"]
    }
  });
  assert.equal(resolution.satisfied, false);
  assert.deepEqual(resolution.missingRequired, ["skill.unknown"]);
});

test("supplemental tool permissions participate in the intersection", () => {
  const resolution = resolveCapabilitySet({
    tools: [
      tool({
        name: "http_write",
        capabilities: ["external.write"],
        source: "custom.http.demo",
        sourceKind: "custom",
        permissionRequirements: ["externalWrite", "network"]
      })
    ],
    mode: "coding",
    workspaceAvailable: true,
    request: {
      requiredCapabilities: ["external.write"],
      permissions: { network: "deny" }
    }
  });

  assert.equal(resolution.satisfied, false);
  assert.deepEqual(
    resolution.toolDecisions.http_write.deniedPermissions,
    ["network"]
  );
});

test("all complementary tools from the preferred provider kind are selected", () => {
  const resolution = resolveCapabilitySet({
    tools: [
      tool({ name: "read_text", capabilities: ["workspace.file.read"] }),
      tool({ name: "inspect_path", capabilities: ["workspace.file.read"] }),
      tool({
        name: "mcp_read",
        capabilities: ["workspace.file.read"],
        source: "mcp.files",
        sourceKind: "mcp"
      })
    ],
    mode: "chat",
    workspaceAvailable: true,
    request: { requiredCapabilities: ["workspace.file.read"] }
  });

  assert.deepEqual(resolution.selectedToolNames, ["inspect_path", "read_text"]);
  const capability = resolution.capabilities.find(
    (item) => item.id === "workspace.file.read"
  );
  assert.deepEqual(
    capability.selectedProviders.map((provider) => provider.sourceKind),
    ["built_in", "built_in"]
  );
});
