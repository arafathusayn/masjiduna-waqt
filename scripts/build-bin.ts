#!/usr/bin/env bun
/**
 * Cross-compile waqt CLI for all supported platforms.
 * Outputs:
 *   dist/waqt-<platform>-<arch>[.exe]  — standalone Bun native binaries (GitHub Releases)
 *   dist/waqt.js                       — Node ESM launcher (npm bin, calls native binary)
 *   dist/preinstall.js                 — preinstall downloader (runs on npm install -g)
 */

const TARGETS: Array<{ flag: string; outfile: string }> = [
  { flag: "bun-darwin-arm64", outfile: "waqt-darwin-arm64" },
  { flag: "bun-darwin-x64", outfile: "waqt-darwin-x64" },
  { flag: "bun-linux-x64", outfile: "waqt-linux-x64" },
  { flag: "bun-linux-arm64", outfile: "waqt-linux-arm64" },
  { flag: "bun-windows-x64", outfile: "waqt-windows-x64.exe" },
];

for (const { flag, outfile } of TARGETS) {
  process.stdout.write(`  building ${outfile}...\n`);
  await Bun.$`bun build bin/waqt.ts --compile --bytecode --minify --target ${flag} --outfile dist/${outfile}`.quiet();
}

// Build the Node ESM launcher — prepend shebang, write to dist/waqt.js
process.stdout.write("  building launcher...\n");
const launcherBuild = await Bun.build({
  entrypoints: ["bin/launcher.ts"],
  target: "node",
  format: "esm",
  minify: true,
});
if (!launcherBuild.success) {
  for (const msg of launcherBuild.logs) console.error(msg);
  process.exit(1);
}
const launcherCode = await launcherBuild.outputs[0]!.text();
await Bun.write("dist/waqt.js", `#!/usr/bin/env node\n${launcherCode}`);
await Bun.$`chmod +x dist/waqt.js`;

// Build the preinstall downloader
process.stdout.write("  building preinstall...\n");
const preinstallBuild = await Bun.build({
  entrypoints: ["bin/preinstall.ts"],
  target: "node",
  format: "esm",
  minify: true,
});
if (!preinstallBuild.success) {
  for (const msg of preinstallBuild.logs) console.error(msg);
  process.exit(1);
}
const preinstallCode = await preinstallBuild.outputs[0]!.text();
await Bun.write("dist/preinstall.js", preinstallCode);

process.stdout.write("  done\n");
