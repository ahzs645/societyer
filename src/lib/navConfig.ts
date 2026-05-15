/**
 * Navigation defaults. Kept in config (not hardcoded in Layout.tsx) so the
 * default pinned sidebar items can be tuned per-tenant without touching UI code.
 */

export const DEFAULT_PINNED_ROUTES: readonly string[] = [
  "/app",
  "/app/annual-cycle",
  "/app/tasks",
  "/app/deadlines",
  "/app/commitments",
  "/app/meetings",
  "/app/documents",
  "/app/assets",
  "/app/integrations",
  "/app/ai-agents",
  "/app/transparency",
];
