const fs = require("fs");
const path = require("path");

/**
 * Parse and normalize the version from .nvmrc.
 */
function getNvmrcVersion(rootDir) {
  const nvmrcPath = path.join(rootDir, ".nvmrc");
  const raw = fs.readFileSync(nvmrcPath, "utf8").trim();
  const version = raw.replace(/^v/, "");

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid .nvmrc version: ${raw}`);
  }

  return version;
}

/**
 * Build semver range used by package metadata.
 */
function getEngineRange(version) {
  const major = Number(version.split(".")[0]);
  return `>=${version} <${major + 1}.0.0`;
}

/**
 * Update package.json engines.node.
 */
function updatePackageJson(rootDir, engineRange, checkOnly) {
  const filePath = path.join(rootDir, "package.json");
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));

  if (!parsed.engines || typeof parsed.engines !== "object") {
    throw new Error("package.json is missing engines object");
  }

  const before = parsed.engines.node;
  const changed = before !== engineRange;

  if (!checkOnly && changed) {
    parsed.engines.node = engineRange;
    fs.writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  }

  return changed;
}

/**
 * Update package-lock.json root engines.node metadata.
 */
function updatePackageLock(rootDir, nvmVersion, checkOnly) {
  const filePath = path.join(rootDir, "package-lock.json");
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const rootPackage = parsed?.packages?.[""];

  if (!rootPackage || !rootPackage.engines) {
    throw new Error("package-lock.json root package engines metadata is missing");
  }

  const expected = `>=${nvmVersion}`;
  const before = rootPackage.engines.node;
  const changed = before !== expected;

  if (!checkOnly && changed) {
    rootPackage.engines.node = expected;
    fs.writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  }

  return changed;
}

/**
 * Update README node version mentions.
 */
function updateReadme(rootDir, nvmVersion, checkOnly) {
  const filePath = path.join(rootDir, "README.md");
  const before = fs.readFileSync(filePath, "utf8");

  const after = before
    .replace(/Node\.js \(v\d+\.\d+\.\d+\+\) and npm installed/g, `Node.js (v${nvmVersion}+) and npm installed`)
    .replace(/Node\.js v\d+\.\d+\.\d+ or newer/g, `Node.js v${nvmVersion} or newer`);

  const changed = before !== after;

  if (!checkOnly && changed) {
    fs.writeFileSync(filePath, after, "utf8");
  }

  return changed;
}

/**
 * Run sync or check mode.
 */
function main() {
  const rootDir = path.resolve(__dirname, "..");
  const checkOnly = process.argv.includes("--check");
  const nvmVersion = getNvmrcVersion(rootDir);
  const engineRange = getEngineRange(nvmVersion);

  const changes = {
    packageJson: updatePackageJson(rootDir, engineRange, checkOnly),
    packageLock: updatePackageLock(rootDir, nvmVersion, checkOnly),
    readme: updateReadme(rootDir, nvmVersion, checkOnly),
  };

  const changedFiles = Object.entries(changes)
    .filter(([, changed]) => changed)
    .map(([name]) => name);

  if (checkOnly && changedFiles.length > 0) {
    console.error(
      `Node version metadata is out of sync with .nvmrc (${nvmVersion}). Run: npm run sync:node-version`
    );
    console.error(`Out of sync: ${changedFiles.join(", ")}`);
    process.exit(1);
  }

  if (changedFiles.length === 0) {
    console.log(`Node version metadata already synced with .nvmrc (${nvmVersion}).`);
    return;
  }

  console.log(`Synced Node version metadata from .nvmrc (${nvmVersion}).`);
  console.log(`Updated: ${changedFiles.join(", ")}`);
}

main();