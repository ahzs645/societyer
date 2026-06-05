import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const electronBin = path.join(root, "node_modules", ".bin", "electron");
const mainEntry = path.join(root, "dist-electron", "electron", "main.js");
const workspaceDir = await mkdtemp(path.join(tmpdir(), "societyer-desktop-smoke-workspace-"));
const userDataDir = await mkdtemp(path.join(tmpdir(), "societyer-desktop-smoke-user-data-"));

const child = spawn(electronBin, [mainEntry, `--user-data-dir=${userDataDir}`], {
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: "",
    SOCIETYER_WORKSPACE_DIR: workspaceDir,
    SOCIETYER_DESKTOP_SMOKE_PROBE: "1",
    ELECTRON_ENABLE_LOGGING: "1",
  },
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

const timeout = setTimeout(() => {
  child.kill();
}, 8_000);

child.on("exit", async () => {
  clearTimeout(timeout);

  await Promise.allSettled([
    rm(workspaceDir, { recursive: true, force: true }),
    rm(userDataDir, { recursive: true, force: true }),
  ]);

  const fatalPatterns = [
    "Cannot find module",
    "MODULE_NOT_FOUND",
    "Refused to execute",
    "Uncaught Error",
    "Uncaught TypeError",
    "Uncaught ReferenceError",
    "ERR_FILE_NOT_FOUND",
  ];
  const failures = fatalPatterns.filter((pattern) => output.includes(pattern));
  if (!output.includes("SOCIETYER_DESKTOP_SMOKE_PROBE_OK")) {
    failures.push("SOCIETYER_DESKTOP_SMOKE_PROBE_OK missing");
  }

  if (failures.length > 0) {
    console.error("\nDesktop smoke test failed:");
    for (const failure of failures) {
      console.error(` - ${failure}`);
    }
    console.error("\nFull output:\n" + output);
    process.exit(1);
  }

  console.log("Desktop smoke test passed.");
  process.exit(0);
});
