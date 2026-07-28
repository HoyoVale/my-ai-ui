import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const args = new Map(
  process.argv.slice(2).map((entry) => {
    const [key, ...rest] = entry.replace(/^--/u, "").split("=");
    return [key, rest.join("=") || "true"];
  })
);
const input = path.resolve(root, args.get("input") ?? "release-artifacts");
const output = path.resolve(root, args.get("output") ?? path.join(input, "release-manifest.json"));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const files = [];
for (const file of fs.readdirSync(input, { recursive: true })) {
  const absolute = path.join(input, file);
  if (!fs.statSync(absolute).isFile() || path.resolve(absolute) === output) continue;
  files.push({
    path: file.split(path.sep).join("/"),
    size: fs.statSync(absolute).size,
    sha256: sha256(absolute)
  });
}
files.sort((a, b) => a.path.localeCompare(b.path));

const manifest = {
  schemaVersion: 1,
  appId: "com.hoyo.xixi.desktop",
  productName: "Xixi Desktop",
  version: packageJson.version,
  tag: `v${packageJson.version}`,
  generatedAt: new Date().toISOString(),
  packageLockSha256: sha256(path.join(root, "package-lock.json")),
  files
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
fs.writeFileSync(
  path.join(path.dirname(output), "SHA256SUMS.txt"),
  `${files.map((file) => `${file.sha256}  ${file.path}`).join("\n")}\n`,
  "utf8"
);
console.log(`Release manifest written with ${files.length} artifacts.`);
