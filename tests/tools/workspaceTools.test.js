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

    it(
      "returns encoding, newline, hash, and optional line numbers",
      async () => {
        fs.writeFileSync(
          path.join(root, "src", "utf16.txt"),
          Buffer.concat([
            Buffer.from([0xff, 0xfe]),
            Buffer.from("alpha\r\nbeta\r\n", "utf16le")
          ])
        );

        const tool = getTool("read_text_file");
        const input = tool.inputSchema.parse({
          path: "src/utf16.txt",
          startLine: 2,
          endLine: 2,
          includeLineNumbers: true
        });
        const result = await tool.execute(input);

        assert.equal(result.encoding, "utf16le");
        assert.equal(result.bom, true);
        assert.equal(result.newline, "crlf");
        assert.equal(result.content, "2: beta");
        assert.match(result.sha256, /^[a-f0-9]{64}$/u);
      }
    );

    it(
      "reads multiple files while isolating per-file failures",
      async () => {
        fs.writeFileSync(path.join(root, "src", "second.txt"), "second\n", "utf8");
        const tool = getTool("read_multiple_files");
        const input = tool.inputSchema.parse({
          paths: ["src/hello.js", ".env", "src/second.txt"],
          maxBytesPerFile: 20_000,
          maxTotalBytes: 100_000
        });
        const result = await tool.execute(input);

        assert.equal(result.requestedFiles, 3);
        assert.equal(result.successfulFiles, 2);
        assert.equal(result.failedFiles, 1);
        assert.equal(result.results[1].ok, false);
        assert.equal(result.results[1].error.code, "SENSITIVE_PATH_BLOCKED");
      }
    );

    it(
      "builds bounded directory listings and project trees",
      async () => {
        fs.mkdirSync(path.join(root, "src", "nested"), { recursive: true });
        fs.writeFileSync(path.join(root, "src", "nested", "keep.js"), "keep\n");
        fs.writeFileSync(path.join(root, "src", "nested", "skip.test.js"), "skip\n");
        fs.mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
        fs.writeFileSync(path.join(root, "node_modules", "pkg", "index.js"), "hidden\n");

        const listTool = getTool("list_directory");
        const listing = await listTool.execute(listTool.inputSchema.parse({
          path: ".",
          depth: 3,
          ignorePatterns: ["**/*.test.js"],
          maxEntries: 100
        }));
        assert.equal(listing.entries.some((entry) => entry.path === "src/nested/keep.js"), true);
        assert.equal(listing.entries.some((entry) => entry.path.includes("node_modules")), false);
        assert.equal(listing.entries.some((entry) => entry.path.endsWith("skip.test.js")), false);

        const treeTool = getTool("list_directory_tree");
        const tree = await treeTool.execute(treeTool.inputSchema.parse({
          path: "src",
          depth: 2,
          maxEntries: 100
        }));
        assert.match(tree.tree, /\[D\] nested/u);
        assert.match(tree.tree, /\[F\] keep\.js/u);
      }
    );

    it(
      "supports metadata file filters and contextual regex text search",
      async () => {
        fs.writeFileSync(
          path.join(root, "src", "search.js"),
          "before\nconst alphaValue = 42;\nafter\n",
          "utf8"
        );
        const fileTool = getTool("search_files");
        const files = await fileTool.execute(fileTool.inputSchema.parse({
          path: ".",
          glob: "**/*.js",
          exclude: ["**/hello.js"],
          fileType: "file",
          minSize: 1,
          maxDepth: 5,
          maxResults: 20
        }));
        assert.equal(files.matches.includes("src/search.js"), true);
        assert.equal(files.matches.includes("src/hello.js"), false);
        assert.equal(files.details[0].type, "file");

        const textTool = getTool("search_text");
        const search = await textTool.execute(textTool.inputSchema.parse({
          path: ".",
          query: "alpha[A-Za-z]+\\s*=\\s*42",
          regex: true,
          include: ["src/**/*.js"],
          contextBefore: 1,
          contextAfter: 1,
          maxMatches: 20
        }));
        assert.equal(search.matches[0].path, "src/search.js");
        assert.equal(search.matches[0].line, 2);
        assert.deepEqual(search.matches[0].before, ["before"]);
        assert.deepEqual(search.matches[0].after, ["after"]);

        await assert.rejects(
          textTool.execute(textTool.inputSchema.parse({
            path: ".",
            query: "(a+)+",
            regex: true
          })),
          (error) => error?.code === "REGEX_TOO_COMPLEX"
        );
      }
    );

    it(
      "compares two safe text files without reporting a write operation",
      async () => {
        fs.writeFileSync(path.join(root, "src", "left.txt"), "one\ntwo\n", "utf8");
        fs.writeFileSync(path.join(root, "src", "right.txt"), "one\nTWO\nthree\n", "utf8");
        const tool = getTool("compare_files");
        const result = await tool.execute(tool.inputSchema.parse({
          leftPath: "src/left.txt",
          rightPath: "src/right.txt"
        }));
        assert.equal(result.identical, false);
        assert.equal(result.addedLines, 2);
        assert.equal(result.removedLines, 1);
        assert.match(result.comparison.diff, /-two/u);
        assert.match(result.comparison.diff, /\+TWO/u);
        assert.equal("changePreview" in result, false);
      }
    );

    it(
      "inspects existing and missing paths without escaping the workspace",
      async () => {
        const tool = getTool("inspect_path");
        const existing = await tool.execute(tool.inputSchema.parse({
          path: "src/hello.js"
        }));
        assert.equal(existing.exists, true);
        assert.equal(existing.type, "file");
        assert.equal(existing.encoding, "utf8");
        assert.match(existing.sha256, /^[a-f0-9]{64}$/u);

        const missing = await tool.execute(tool.inputSchema.parse({
          path: "src/missing.js"
        }));
        assert.equal(missing.exists, false);
        assert.equal(missing.type, "missing");
      }
    );
  }
);

describe("continuity read cache", () => {
  it("reuses an unchanged file read and invalidates the cache after a write", async () => {
    const cacheDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "xixi-continuity-read-cache-")
    );
    try {
      const definitions = createWorkspaceToolDefinitions({
        roots: [root],
        continuityReadCacheDirectory: cacheDirectory
      });
      const read = definitions.find((tool) => tool.name === "read_text_file");
      const first = await read.execute({
        path: "src/hello.js",
        startLine: 1
      });
      const second = await read.execute({
        path: "src/hello.js",
        startLine: 1
      });

      assert.equal(first.cacheReused, false);
      assert.equal(second.cacheReused, true);
      assert.equal(second.sha256, first.sha256);

      await new Promise((resolve) => setTimeout(resolve, 15));
      fs.writeFileSync(
        path.join(root, "src", "hello.js"),
        "export const hello = 'changed';\n",
        "utf8"
      );
      const third = await read.execute({
        path: "src/hello.js",
        startLine: 1
      });

      assert.equal(third.cacheReused, false);
      assert.notEqual(third.sha256, first.sha256);
      assert.match(third.content, /changed/u);
    } finally {
      fs.rmSync(cacheDirectory, { recursive: true, force: true });
    }
  });
});
