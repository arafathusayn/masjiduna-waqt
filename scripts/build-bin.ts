#!/usr/bin/env bun
/**
 * Cross-compile waqt CLI for all supported platforms.
 * Output: dist/waqt-<platform>-<arch>[.exe]  +  dist/waqt.mjs (Node ESM launcher)
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

// Build the launcher as Node ESM, prepend shebang, write to dist/waqt
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
await Bun.write("dist/waqt", `#!/usr/bin/env node\n${launcherCode}`);
await Bun.$`chmod +x dist/waqt`;

process.stdout.write("  done\n");
