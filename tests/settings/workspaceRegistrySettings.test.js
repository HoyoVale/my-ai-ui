import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import {
  sanitizeSettings
} from "../../electron/settings/validateSettings.js";

describe(
  "workspace registry settings",
  () => {
    it(
      "migrates legacy workspace roots into stable registry entries",
      () => {
        const settings = sanitizeSettings({
          tools: {
            workspace: {
              roots: [
                " C:\\Projects\\Alpha ",
                "C:\\Projects\\Alpha",
                "D:\\Projects\\Beta"
              ]
            }
          }
        });

        assert.deepEqual(
          settings.workspaces.items.map(
            (workspace) => workspace.rootPath
          ),
          [
            "C:\\Projects\\Alpha",
            "D:\\Projects\\Beta"
          ]
        );
        assert.equal(
          new Set(
            settings.workspaces.items.map(
              (workspace) => workspace.id
            )
          ).size,
          2
        );
        assert.equal(
          Object.hasOwn(
            settings.tools.workspace,
            "roots"
          ),
          false
        );
      }
    );

    it(
      "preserves registered workspace identity and metadata",
      () => {
        const settings = sanitizeSettings({
          workspaces: {
            items: [
              {
                id: "workspace-alpha",
                name: "Alpha",
                rootPath: "/projects/alpha",
                canonicalPath: "/projects/alpha",
                createdAt: 100,
                lastOpenedAt: 200
              }
            ]
          }
        });

        assert.deepEqual(
          settings.workspaces.items,
          [
            {
              id: "workspace-alpha",
              name: "Alpha",
              rootPath: "/projects/alpha",
              canonicalPath: "/projects/alpha",
              createdAt: 100,
              lastOpenedAt: 200
            }
          ]
        );
      }
    );
  }
);
