import { writeFile } from "node:fs/promises";
import path from "node:path";

function resolveCommit() {
  const fromEnv = process.env.SOCIETYER_BUILD_COMMIT || process.env.GITHUB_SHA;
  if (/^[0-9a-f]{7,40}$/i.test(fromEnv || "")) return fromEnv.slice(0, 12).toLowerCase();
  return null;
}

const commit = resolveCommit();
const outputPath = path.resolve("electron/buildMetadata.ts");
await writeFile(
  outputPath,
  `export const SOCIETYER_BUILD_COMMIT = ${commit ? JSON.stringify(commit) : "null"};\n`,
);
