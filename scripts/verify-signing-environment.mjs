const args = new Map(
  process.argv.slice(2).map((entry) => {
    const [key, ...rest] = entry.replace(/^--/u, "").split("=");
    return [key, rest.join("=") || "true"];
  })
);
const platform = String(args.get("platform") ?? process.platform);
const allowUnsigned = args.get("allow-unsigned") === "true";

const requirements = {
  win32: ["CSC_LINK", "CSC_KEY_PASSWORD"],
  darwin: [
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "APPLE_TEAM_ID"
  ],
  linux: []
};

const missing = (requirements[platform] ?? []).filter(
  (name) => !String(process.env[name] ?? "").trim()
);

if (missing.length && !allowUnsigned) {
  throw new Error(
    `Missing signing environment for ${platform}: ${missing.join(", ")}`
  );
}

if (missing.length) {
  console.warn(
    `Unsigned release build allowed for ${platform}; missing: ${missing.join(", ")}.`
  );
} else {
  console.log(`Signing environment verified for ${platform}.`);
}
