import { createLocalWorkspaceAdapter } from "./localWorkspaceAdapter";

const localWorkspaceAdapter = createLocalWorkspaceAdapter();

// Keep app startup pointed at a local adapter boundary. The adapter currently
// delegates to the static/demo client, but Electron can replace this module
// with a workspace-scoped Dexie implementation without touching the router or
// provider wiring.
export const localDataClient = localWorkspaceAdapter.client;

export function reseedLocalData() {
  return localWorkspaceAdapter.reseed();
}
