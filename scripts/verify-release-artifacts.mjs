import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Map(process.argv.slice(2).map((entry) => {
  const [key, ...rest] = entry.replace(/^--/u, "").split("=");
  return [key, rest.join("=") || "true"];
}));
const platform = String(args.get("platform") ?? process.platform);
const directory = path.resolve(root, args.get("directory") ?? `release/${platform}`);

if (!fs.existsSync(directory)) {
  throw new Error(`Release directory is missing: ${directory}`);
}

const files = fs.readdirSync(directory, { recursive: true }).filter((entry) => {
  const absolute = path.join(directory, entry);
  return fs.statSync(absolute).isFile() && fs.statSync(absolute).size > 0;
});
const has = (pattern) => files.some((file) => pattern.test(file));
const requirements = {
  win32: [/setup\.exe$/iu, /latest(?:-[a-z]+)?\.yml$/iu],
  darwin: [/\.dmg$/iu, /\.zip$/iu, /latest-mac(?:-[a-z]+)?\.yml$/iu],
  linux: [/\.AppImage$/u, /latest-linux(?:-[a-z]+)?\.yml$/iu]
};

for (const pattern of requirements[platform] ?? []) {
  if (!has(pattern)) {
    throw new Error(`Missing ${platform} release artifact matching ${pattern}.`);
  }
}

console.log(`Verified ${files.length} release files for ${platform}.`);
