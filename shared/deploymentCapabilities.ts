import { resolveSessionBroker, type AuthEnvironment } from "./authConfiguration";

/**
 * Optional services a hosted deployment may run beside Convex. Features that
 * need one stay hidden until the operator says it exists, rather than showing
 * buttons that fail.
 */
export type DeploymentCapabilities = {
  /** The Node API gateway (`npm run auth:server`). Absent with Convex-hosted sign-in, which replaces it. */
  gatewayApi: boolean;
  /** The browser connector runner (Docker `connectors` profile) behind the gateway. */
  browserConnectors: boolean;
  /** n8n, which calls back into the gateway with results. */
  n8nWorkflows: boolean;
};

export const ALL_CAPABILITIES: DeploymentCapabilities = { gatewayApi: true, browserConnectors: true, n8nWorkflows: true };

export function deploymentCapabilities(env: AuthEnvironment): DeploymentCapabilities {
  const gatewayApi = resolveSessionBroker(env) !== "convex";
  return {
    gatewayApi,
    // Opt-in: the runner is a separate container most deployments don't run.
    browserConnectors: gatewayApi && env.SOCIETYER_BROWSER_CONNECTORS === "1",
    // The same settings a run needs, so a configured n8n is never hidden.
    n8nWorkflows: gatewayApi && Boolean(env.N8N_WEBHOOK_BASE_URL?.trim()) && Boolean(env.SOCIETYER_WORKFLOW_CALLBACK_SECRET?.trim()),
  };
}

export const N8N_UNAVAILABLE_MESSAGE =
  "n8n workflows aren't set up on this deployment. An operator sets N8N_WEBHOOK_BASE_URL and SOCIETYER_WORKFLOW_CALLBACK_SECRET on Convex and runs the API gateway to enable them.";
