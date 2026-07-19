import {
  afterEach,
  beforeEach,
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createWorkspaceToolDefinitions
} from "../../electron/tools/workspace/workspaceTools.js";

let root;

function getTool(name) {
  return createWorkspaceToolDefinitions({
    roots: [root]
  }).find(
    (tool) =>
      tool.name === name
  );
}

beforeEach(() => {
  root = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "xixi-tools-"
    )
  );

  fs.mkdirSync(
    path.join(root, "src")
  );
  fs.writeFileSync(
    path.join(
      root,
      "src",
      "hello.js"
    ),
    "export const hello = 'world';\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(
      root,
      "package.json"
    ),
    JSON.stringify({
      name: "sample",
      scripts: {
        test: "node --test"
      }
    }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(root, ".env"),
    "SECRET=value\n",
    "utf8"
  );
});

afterEach(() => {
  fs.rmSync(root, {
    recursive: true,
    force: true
  });
});

describe(
  "workspace read tools",
  () => {
    it(
      "lists and reads safe files inside the workspace",
      async () => {
        const listing =
          await getTool(
            "list_directory"
          ).execute({
            path: ".",
            maxEntries: 50
          });

        assert.equal(
          listing.entries.some(
            (entry) =>
              entry.name === "src"
          ),
          true
        );

        const result =
          await getTool(
            "read_text_file"
          ).execute({
            path:
              "src/hello.js",
            startLine: 1
          });

        assert.match(
          result.content,
          /world/u
        );
      }
    );

    it(
      "blocks sensitive files and paths outside the workspace",
      async () => {
        await assert.rejects(
          getTool(
            "read_text_file"
          ).execute({
            path: ".env",
            startLine: 1
          }),
          /敏感/u
        );

        await assert.rejects(
          getTool(
            "read_text_file"
          ).execute({
            path:
              path.join(
                os.tmpdir(),
                "outside.txt"
              ),
            startLine: 1
          }),
          /工作区/u
        );
      }
    );

    it(
      "searches text and detects the project without executing commands",
      async () => {
        const search =
          await getTool(
            "search_text"
          ).execute(
            {
              path: ".",
              query: "world",
              caseSensitive: false,
              maxDepth: 4,
              maxResults: 20
            },
            {}
          );

        assert.equal(
          search.matches[0].path,
          "src/hello.js"
        );

        const project =
          await getTool(
            "detect_project"
          ).execute({
            path: "."
          });

        assert.equal(
          project.package.name,
          "sample"
        );
        assert.equal(
          project.manifests[0].name,
          "package.json"
        );
      }
    );
  }
);
