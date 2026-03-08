/**
 * Rebuilds native Node addons in the server package for Electron's Node ABI.
 *
 * `bun install` compiles native modules (e.g. `node-pty`) against Bun's bundled
 * Node ABI, which causes a SIGSEGV when loaded under Electron's Node runtime
 * (ELECTRON_RUN_AS_NODE=1). This script uses `@electron/rebuild` to recompile
 * them for Electron's embedded Node version.
 *
 * Skipped entirely when running under Bun (non-desktop mode).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, "..");
const serverDir = resolve(desktopDir, "..", "server");

// Modules in apps/server that need to be rebuilt for Electron's Node ABI.
const NATIVE_MODULES = ["node-pty"];

const require = createRequire(join(desktopDir, "package.json"));
const electronVersion = require("electron/package.json").version;

const sentinelPath = join(serverDir, "node_modules", ".electron-rebuild-sentinel");

function needsRebuild() {
  if (!existsSync(sentinelPath)) return true;
  try {
    const data = JSON.parse(readFileSync(sentinelPath, "utf8"));
    return data.electronVersion !== electronVersion;
  } catch {
    return true;
  }
}

if (!needsRebuild()) {
  process.exit(0);
}

console.log(
  `[rebuild-native] Rebuilding native modules for Electron ${electronVersion}...`,
);

try {
  execSync(
    [
      "npx",
      "@electron/rebuild",
      `--version=${electronVersion}`,
      `--module-dir=${serverDir}`,
      `--only=${NATIVE_MODULES.join(",")}`,
    ].join(" "),
    { stdio: "inherit", cwd: desktopDir },
  );
} catch (error) {
  console.error("[rebuild-native] Failed to rebuild native modules:", error.message);
  process.exit(1);
}

writeFileSync(sentinelPath, JSON.stringify({ electronVersion }, null, 2) + "\n");
console.log("[rebuild-native] Done.");
