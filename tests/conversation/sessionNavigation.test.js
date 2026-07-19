import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  filterSessionsForContext,
  groupSessionsByWorkspace
} from "../../src/shared/sessionNavigation.js";

const conversations = [
  {
    id: "chat-none",
    title: "General",
    mode: "chat",
    workspaceId: null,
    updatedAt: 1
  },
  {
    id: "chat-alpha-new",
    title: "Alpha new",
    mode: "chat",
    workspaceId: "workspace-a",
    updatedAt: 3
  },
  {
    id: "chat-alpha-old",
    title: "Alpha old",
    mode: "chat",
    workspaceId: "workspace-a",
    updatedAt: 2
  },
  {
    id: "coding-alpha",
    title: "Coding Alpha",
    mode: "coding",
    workspaceId: "workspace-a",
    updatedAt: 4
  }
];

const workspaces = [
  {
    id: "workspace-a",
    name: "Alpha"
  }
];

describe("session navigation helpers", () => {
  it("filters the session menu by both mode and workspace", () => {
    assert.deepEqual(
      filterSessionsForContext(
        conversations,
        {
          mode: "chat",
          workspaceId: "workspace-a"
        }
      ).map((conversation) => conversation.id),
      [
        "chat-alpha-new",
        "chat-alpha-old"
      ]
    );

    assert.deepEqual(
      filterSessionsForContext(
        conversations,
        {
          mode: "chat",
          workspaceId: null
        }
      ).map((conversation) => conversation.id),
      ["chat-none"]
    );
  });

  it("groups sidebar sessions by workspace without adding workspace labels to each row", () => {
    const groups = groupSessionsByWorkspace(
      conversations.filter((conversation) => conversation.mode === "chat"),
      workspaces
    );

    assert.equal(groups[0].label, "无工作区");
    assert.equal(groups[1].label, "Alpha");
    assert.deepEqual(
      groups[1].conversations.map((conversation) => conversation.id),
      [
        "chat-alpha-new",
        "chat-alpha-old"
      ]
    );
  });
});
