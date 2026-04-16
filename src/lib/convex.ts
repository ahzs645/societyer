import { ConvexReactClient } from "convex/react";
import { isStaticDemoRuntime } from "./staticRuntime";

const url = import.meta.env.VITE_CONVEX_URL as string | undefined;

if (!url && import.meta.env.DEV && !isStaticDemoRuntime()) {
  console.warn(
    "[societyer] VITE_CONVEX_URL is not set. Run `npx convex dev` (or point to a self-hosted backend) and restart the dev server.",
  );
}

export const convex = new ConvexReactClient(url || "http://127.0.0.1:3210");
