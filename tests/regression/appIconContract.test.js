import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(
    path.join(root, relativePath)
  );
}

test("floral wisteria app icon assets have valid container signatures", () => {
  const pngSignature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47,
    0x0d, 0x0a, 0x1a, 0x0a
  ]);

  for (
    const relativePath
    of [
      "public/icon.png",
      "public/favicon.png",
      "public/icon-16x16.png",
      "public/icon-32x32.png",
      "public/icon-180x180.png",
      "public/icon-192x192.png",
      "public/icon-512x512.png"
    ]
  ) {
    const data = read(relativePath);
    assert.ok(
      data.length > 100,
      `${relativePath} should not be empty`
    );
    assert.deepEqual(
      data.subarray(0, 8),
      pngSignature,
      `${relativePath} should be a PNG`
    );
  }

  assert.deepEqual(
    read("public/favicon.ico")
      .subarray(0, 4),
    Buffer.from([0, 0, 1, 0])
  );
});

test("web, Electron windows, and tray reference the generated icons", () => {
  const index = read("index.html").toString();
  const createWindow = read(
    "electron/core/createWindow.js"
  ).toString();
  const tray = read(
    "electron/windows/tray/trayManager.js"
  ).toString();

  assert.match(index, /\/favicon\.ico/u);
  assert.match(index, /\/icon-32x32\.png/u);
  assert.match(index, /\/icon-180x180\.png/u);
  assert.match(createWindow, /"public",\s*"icon\.png"/u);
  assert.match(createWindow, /icon:\s*appIconPath/u);
  assert.match(tray, /"public",\s*"icon-32x32\.png"/u);
});
