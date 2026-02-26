/**
 * Preinstall: download the platform-specific waqt native binary from GitHub Releases.
 * Saves to ~/.waqt/bin/ so the launcher (dist/waqt.js) can find it.
 * Always exits 0 — never fails the npm/bun install.
 */
import { existsSync, mkdirSync, chmodSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BINARY_MAP: Record<string, Record<string, string>> = {
  darwin: { arm64: "waqt-darwin-arm64", x64: "waqt-darwin-x64" },
  linux: { x64: "waqt-linux-x64", arm64: "waqt-linux-arm64" },
  win32: { x64: "waqt-windows-x64.exe" },
};

async function main(): Promise<void> {
  // Only download for global installs — skip when added as a library dependency.
  const isGlobal =
    process.env["npm_config_global"] === "true" ||
    process.env["BUN_INSTALL"] != null;
  if (!isGlobal) return;

  const platformBins = BINARY_MAP[process.platform];
  if (!platformBins) return; // unsupported platform, skip silently

  const binaryName = platformBins[process.arch];
  if (!binaryName) return; // unsupported arch, skip silently

  const binDir = join(homedir(), ".waqt", "bin");
  const binPath = join(binDir, binaryName);

  if (existsSync(binPath)) return; // already installed

  const version = process.env["npm_package_version"];
  if (!version) return;

  const url = `https://github.com/arafathusayn/masjiduna-waqt/releases/download/v${version}/${binaryName}`;
  process.stdout.write(
    `\nwaqt: downloading ${binaryName} from GitHub Releases…\n`,
  );

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    process.stdout.write(
      `waqt: download failed (network error).\n` +
        `      Get the binary at: https://github.com/arafathusayn/masjiduna-waqt/releases\n\n`,
    );
    return;
  }

  if (!response.ok) {
    process.stdout.write(
      `waqt: download failed (HTTP ${response.status}).\n` +
        `      Get the binary at: https://github.com/arafathusayn/masjiduna-waqt/releases\n\n`,
    );
    return;
  }

  mkdirSync(binDir, { recursive: true });
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(binPath, buffer);
  if (process.platform !== "win32") chmodSync(binPath, 0o755);

  process.stdout.write(`waqt: installed to ${binPath}\n\n`);
}

main().catch(() => {
  // swallow all errors — install must never fail because of us
});
