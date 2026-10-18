import { resolveSessionBroker, type AuthEnvironment } from "./authConfiguration";
import { procurementSharePointConfigured } from "./procurementReview/storage";

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
  /** Reading published procurement snapshots, which needs the deployment's SharePoint application connection. */
  procurementReview: boolean;
};

export const ALL_CAPABILITIES: DeploymentCapabilities = { gatewayApi: true, browserConnectors: true, n8nWorkflows: true, procurementReview: true };

/** The local and desktop runtimes bring their own services, but have no Convex route to read SharePoint through. */
export const LOCAL_RUNTIME_CAPABILITIES: DeploymentCapabilities = { ...ALL_CAPABILITIES, procurementReview: false };

/** The no-login demo simulates every service; procurement review reads the snapshot bundled with the app. */
export const STATIC_DEMO_CAPABILITIES: DeploymentCapabilities = ALL_CAPABILITIES;

export function deploymentCapabilities(env: AuthEnvironment): DeploymentCapabilities {
  const gatewayApi = resolveSessionBroker(env) !== "convex";
  return {
    gatewayApi,
    // Opt-in: the runner is a separate container most deployments don't run.
    browserConnectors: gatewayApi && env.SOCIETYER_BROWSER_CONNECTORS === "1",
    // The same settings a run needs, so a configured n8n is never hidden.
    n8nWorkflows: gatewayApi && Boolean(env.N8N_WEBHOOK_BASE_URL?.trim()) && Boolean(env.SOCIETYER_WORKFLOW_CALLBACK_SECRET?.trim()),
    // Convex reads the snapshot itself, so this works with or without the gateway.
    procurementReview: procurementSharePointConfigured(env),
  };
}

export const PROCUREMENT_REVIEW_UNAVAILABLE_MESSAGE =
  "Procurement review needs its separate SharePoint reader connection. An operator sets the PROCUREMENT_SHAREPOINT_* application settings on Convex to enable it.";

export const N8N_UNAVAILABLE_MESSAGE =
  "n8n workflows aren't set up on this deployment. An operator sets N8N_WEBHOOK_BASE_URL and SOCIETYER_WORKFLOW_CALLBACK_SECRET on Convex and runs the API gateway to enable them.";
