import { spawnSync } from "node:child_process";
import { config } from "dotenv";

config({ path: ".env.local" });
config();

const target = process.argv[2];
const token = process.env.SOCIETYER_MAINTENANCE_TOKEN ?? process.env.CONVEX_INSTANCE_SECRET;

if (!target) {
  console.error("Usage: node scripts/convex-maintenance.mjs <module:function>");
  process.exit(1);
}

if (!token) {
  console.error("Set SOCIETYER_MAINTENANCE_TOKEN or CONVEX_INSTANCE_SECRET before running maintenance mutations.");
  process.exit(1);
}

const result = spawnSync(
  "npx",
  ["convex", "run", target, JSON.stringify({ serviceToken: token })],
  { stdio: "inherit" },
);

process.exit(result.status ?? 1);

