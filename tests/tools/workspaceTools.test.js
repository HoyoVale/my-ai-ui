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
      "supports bounded high-line reads and rejects starts past EOF",
      async () => {
        const lines = Array.from({ length: 1_500 }, (_, index) => `line-${index + 1}`);
        fs.writeFileSync(path.join(root, "src", "large.txt"), `${lines.join("\n")}\n`, "utf8");

        const result = await getTool("read_text_file").execute({
          path: "src/large.txt",
          startLine: 1_201,
          endLine: 1_210
        });
        assert.equal(result.startLine, 1_201);
        assert.equal(result.endLine, 1_210);
        assert.match(result.content, /^line-1201/u);
        assert.equal(result.hasMoreBefore, true);
        assert.equal(result.hasMoreAfter, true);

        await assert.rejects(
          getTool("read_text_file").execute({
            path: "src/large.txt",
            startLine: 2_000
          }),
          (error) => error?.code === "LINE_RANGE_OUT_OF_BOUNDS"
        );
      }
    );

    it(
      "blocks direct reads from excluded dependency and build directories",
      async () => {
        fs.mkdirSync(path.join(root, "node_modules", "demo"), { recursive: true });
        fs.writeFileSync(
          path.join(root, "node_modules", "demo", "index.js"),
          "module.exports = true;\n",
          "utf8"
        );
        await assert.rejects(
          getTool("read_text_file").execute({
            path: "node_modules/demo/index.js",
            startLine: 1
          }),
          (error) => error?.code === "EXCLUDED_PATH_BLOCKED"
        );
      }
    );

    it(
      "rejects invalid UTF-8 and supports deterministic recursive Glob matching",
      async () => {
        fs.writeFileSync(
          path.join(root, "src", "invalid.txt"),
          Buffer.from([0xc3, 0x28])
        );
        await assert.rejects(
          getTool("read_text_file").execute({
            path: "src/invalid.txt",
            startLine: 1
          }),
          (error) => error?.code === "INVALID_TEXT_ENCODING"
        );

        fs.mkdirSync(path.join(root, "src", "nested"), { recursive: true });
        fs.writeFileSync(path.join(root, "src", "nested", "alpha.js"), "a\n");
        fs.writeFileSync(path.join(root, "src", "zeta.js"), "z\n");
        const search = await getTool("search_files").execute({
          path: ".",
          pattern: "**/*.js",
          maxDepth: 5,
          maxResults: 20
        });
        assert.deepEqual(search.matches, [
          "src/hello.js",
          "src/zeta.js",
          "src/nested/alpha.js"
        ]);
        assert.equal(search.truncated, false);
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
