import { spawnSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const BINARIES: Partial<Record<string, Partial<Record<string, string>>>> = {
  darwin: { arm64: "waqt-darwin-arm64", x64: "waqt-darwin-x64" },
  linux: { x64: "waqt-linux-x64", arm64: "waqt-linux-arm64" },
  win32: { x64: "waqt-windows-x64.exe" },
};

const platform = BINARIES[process.platform];
if (!platform) {
  process.stderr.write(`waqt: unsupported platform: ${process.platform}\n`);
  process.exit(1);
}

const binaryName = platform[process.arch];
if (!binaryName) {
  process.stderr.write(
    `waqt: unsupported arch: ${process.arch} on ${process.platform}\n`,
  );
  process.exit(1);
}

const dir = dirname(fileURLToPath(import.meta.url));
const binaryPath = join(dir, binaryName);

const result = spawnSync(binaryPath, process.argv.slice(2), {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
