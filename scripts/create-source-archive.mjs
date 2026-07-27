import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyCoreLiteTree } from "./verify-core-lite-tree.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const ZIP_LOCAL_HEADER = 0x04034b50;
const ZIP_CENTRAL_HEADER = 0x02014b50;
const ZIP_END_HEADER = 0x06054b50;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const DOS_DATE_1980_01_01 = 0x0021;

const EXCLUDED_NAMES = new Set([
  ".git",
  ".env",
  "node_modules",
  "dist",
  "dist-ssr",
  "test-results",
  "playwright-report",
  "logs",
  "temp.log",
  ".DS_Store"
]);

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    table[value] = crc >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parseOutputPath(argv) {
  const outputIndex = argv.indexOf("--output");
  const supplied = outputIndex >= 0
    ? argv[outputIndex + 1]
    : argv.find((arg) => !arg.startsWith("--"));
  return path.resolve(
    PROJECT_ROOT,
    supplied || path.join("..", `${path.basename(PROJECT_ROOT)}-source.zip`)
  );
}

function shouldExclude(relativePath, entryName) {
  if (EXCLUDED_NAMES.has(entryName)) return true;
  if (entryName.endsWith(".zip")) return true;
  if (/^electron-linux/i.test(entryName)) return true;
  if (/^corelite-.*-(work|cold)$/i.test(entryName)) return true;
  const normalized = relativePath.split(path.sep).join("/");
  return normalized.startsWith(".git/");
}

function copySourceTree(sourceDir, targetDir, relativeDir = "") {
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const relativePath = path.join(relativeDir, entry.name);
    if (shouldExclude(relativePath, entry.name)) continue;

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    const stat = fs.lstatSync(sourcePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Source archive refuses symbolic links: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      fs.mkdirSync(targetPath, { recursive: true });
      copySourceTree(sourcePath, targetPath, relativePath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function listFiles(rootDir) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        files.push({
          absolutePath,
          relativePath: path.relative(rootDir, absolutePath).split(path.sep).join("/")
        });
      }
    }
  };
  visit(rootDir);
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function createStoredZip(sourceDir, outputPath) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const file of listFiles(sourceDir)) {
    const name = Buffer.from(file.relativePath, "utf8");
    const content = fs.readFileSync(file.absolutePath);
    const checksum = crc32(content);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(ZIP_LOCAL_HEADER, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6);
    localHeader.writeUInt16LE(ZIP_STORE_METHOD, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(DOS_DATE_1980_01_01, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(ZIP_CENTRAL_HEADER, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(ZIP_UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(ZIP_STORE_METHOD, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(DOS_DATE_1980_01_01, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);

    localOffset += localHeader.length + name.length + content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endHeader = Buffer.alloc(22);
  const entryCount = centralParts.length / 2;
  endHeader.writeUInt32LE(ZIP_END_HEADER, 0);
  endHeader.writeUInt16LE(0, 4);
  endHeader.writeUInt16LE(0, 6);
  endHeader.writeUInt16LE(entryCount, 8);
  endHeader.writeUInt16LE(entryCount, 10);
  endHeader.writeUInt32LE(centralDirectory.length, 12);
  endHeader.writeUInt32LE(localOffset, 16);
  endHeader.writeUInt16LE(0, 20);

  fs.writeFileSync(outputPath, Buffer.concat([...localParts, centralDirectory, endHeader]));
}

function safeArchivePath(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/u.test(normalized)) {
    throw new Error(`Unsafe archive path: ${relativePath}`);
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe archive path: ${relativePath}`);
  }
  return parts.join(path.sep);
}

function extractStoredZip(zipPath, targetDir) {
  const archive = fs.readFileSync(zipPath);
  let offset = 0;
  while (offset + 4 <= archive.length) {
    const signature = archive.readUInt32LE(offset);
    if (signature === ZIP_CENTRAL_HEADER || signature === ZIP_END_HEADER) break;
    if (signature !== ZIP_LOCAL_HEADER) {
      throw new Error(`Unexpected ZIP signature at offset ${offset}`);
    }

    const method = archive.readUInt16LE(offset + 8);
    const expectedCrc = archive.readUInt32LE(offset + 14);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const uncompressedSize = archive.readUInt32LE(offset + 22);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    if (method !== ZIP_STORE_METHOD || compressedSize !== uncompressedSize) {
      throw new Error("Source archive contains an unsupported compressed entry");
    }

    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLength;
    const contentStart = nameEnd + extraLength;
    const contentEnd = contentStart + compressedSize;
    if (contentEnd > archive.length) throw new Error("Truncated source archive entry");

    const relativePath = archive.subarray(nameStart, nameEnd).toString("utf8");
    const outputPath = path.join(targetDir, safeArchivePath(relativePath));
    const content = archive.subarray(contentStart, contentEnd);
    if (crc32(content) !== expectedCrc) throw new Error(`CRC mismatch: ${relativePath}`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, content);
    offset = contentEnd;
  }
}

function fileHashes(rootDir) {
  return new Map(listFiles(rootDir).map(({ absolutePath, relativePath }) => [
    relativePath,
    crypto.createHash("sha256").update(fs.readFileSync(absolutePath)).digest("hex")
  ]));
}

function assertEqualTrees(expectedRoot, actualRoot) {
  const expected = fileHashes(expectedRoot);
  const actual = fileHashes(actualRoot);
  const allPaths = new Set([...expected.keys(), ...actual.keys()]);
  const differences = [];
  for (const relativePath of [...allPaths].sort()) {
    if (!expected.has(relativePath)) differences.push(`unexpected: ${relativePath}`);
    else if (!actual.has(relativePath)) differences.push(`missing: ${relativePath}`);
    else if (expected.get(relativePath) !== actual.get(relativePath)) differences.push(`changed: ${relativePath}`);
  }
  if (differences.length) {
    throw new Error(`Archive round-trip mismatch:\n${differences.slice(0, 20).join("\n")}`);
  }
  return expected.size;
}

const verification = verifyCoreLiteTree();
if (!verification.ok) {
  throw new Error(`Refusing to archive an invalid Core Lite tree:\n${verification.errors.join("\n")}`);
}

const outputPath = parseOutputPath(process.argv.slice(2));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "my-ai-ui-source-"));
const stagingDir = path.join(tempRoot, "staging");
const extractedDir = path.join(tempRoot, "extracted");

try {
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.mkdirSync(extractedDir, { recursive: true });
  copySourceTree(PROJECT_ROOT, stagingDir);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.rmSync(outputPath, { force: true });
  createStoredZip(stagingDir, outputPath);
  extractStoredZip(outputPath, extractedDir);
  const fileCount = assertEqualTrees(stagingDir, extractedDir);
  const archiveHash = crypto.createHash("sha256").update(fs.readFileSync(outputPath)).digest("hex");

  console.log(`Source archive created: ${outputPath}`);
  console.log(`Files: ${fileCount}`);
  console.log(`SHA-256: ${archiveHash}`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
