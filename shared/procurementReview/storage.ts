import { createDeploymentSharePointAdapter, sharePointDeploymentConfigured } from "../storage/sharePointDeployment";

type Environment = Record<string, string | undefined>;
const CONNECTION_KEYS = ["TENANT_ID", "CLIENT_ID", "CLIENT_SECRET", "SITE_ID", "DRIVE_ID", "TRANSFER_HOSTS"] as const;

/** A separate read-only site connection, never the meeting/document writer. */
export function procurementSharePointEnvironment(env: Environment): Environment {
  return Object.fromEntries(CONNECTION_KEYS.map(key => [`SHAREPOINT_${key}`, env[`PROCUREMENT_SHAREPOINT_${key}`]]));
}

export function procurementSharePointConfigured(env: Environment): boolean {
  return sharePointDeploymentConfigured(procurementSharePointEnvironment(env));
}

export function createProcurementSharePointAdapter(env: Environment, request: typeof fetch = fetch) {
  return createDeploymentSharePointAdapter(procurementSharePointEnvironment(env), request);
}
