import { ConvexReactClient } from "convex/react";
import { isLocalDataRuntime } from "./staticRuntime";
import { resolveAppRuntime, resolvedConvexUrl } from "./appRuntime";

const resolution = resolveAppRuntime();

if (resolution.kind === "server" && resolution.source === "dev-fallback" && !isLocalDataRuntime()) {
  console.warn(
    "[societyer] VITE_CONVEX_URL is not set. Run `npx convex dev` (or point to a self-hosted backend) and restart the dev server.",
  );
}

// By default Convex confirms the first token, then fetches and confirms a
// second one, which adds a token round trip and makes the server re-run every
// authenticated query during sign-in. Better Auth mints a fresh token on every
// request, and a cached Clerk token has still been accepted by the server, so
// keep the first one; Convex schedules the refresh from its expiry.
export const convex = new ConvexReactClient(resolvedConvexUrl(), { initialAuthTokenReuse: true });
