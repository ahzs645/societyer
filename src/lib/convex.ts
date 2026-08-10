import { ConvexReactClient } from "convex/react";
import { isLocalDataRuntime } from "./staticRuntime";
import { resolveAppRuntime, resolvedConvexUrl } from "./appRuntime";

const resolution = resolveAppRuntime();

if (resolution.kind === "server" && resolution.source === "dev-fallback" && !isLocalDataRuntime()) {
  console.warn(
    "[societyer] VITE_CONVEX_URL is not set. Run `npx convex dev` (or point to a self-hosted backend) and restart the dev server.",
  );
}

export const convex = new ConvexReactClient(resolvedConvexUrl());
