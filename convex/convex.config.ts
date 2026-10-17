import { defineApp } from "convex/server";
import betterAuth from "@convex-dev/better-auth/convex.config";

const app = defineApp();
// Login accounts and sessions for the Convex-hosted session broker
// (AUTH_MODE=convex). Its tables live in the component's own namespace, so
// they never mix with the workspace-membership `users` table.
app.use(betterAuth);

export default app;
