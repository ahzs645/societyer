import assert from "node:assert/strict";

import type { DesktopWorkspaceInfo } from "../src/lib/desktopBridge";
import { desktopWorkspaceDatabaseBinding } from "../src/lib/localWorkspaceAdapter";
import type { RuntimeDescriptor } from "../src/lib/runtimeMode";

const runtime: RuntimeDescriptor = {
  mode: "electron-local",
  documentStorage: "local-filesystem",
  capabilities: {
    localData: true,
    nativeFiles: true,
    liveCollaboration: false,
    serverActions: false,
  },
};
const legacyDatabaseName = "societyer-local-electron-local-local-filesystem-workspace";
const bindingKey = `societyer.desktop.legacyDexieWorkspace.${legacyDatabaseName}`;

class StubStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  clear() {
    this.values.clear();
  }
}

function bridge(workspace: DesktopWorkspaceInfo | null, error?: Error) {
  return {
    async getWorkspaceInfo() {
      if (error) throw error;
      return workspace;
    },
  };
}

const storage = new StubStorage();
const originalWorkspace = { id: "workspace-original", legacyDexieWorkspace: true };
const secondWorkspace = { id: "workspace-second" };

// Fresh install: a new workspace gets its own database and cannot claim the legacy name.
assert.deepEqual(
  await desktopWorkspaceDatabaseBinding(runtime, { bridge: bridge(secondWorkspace), storage }),
  { databaseName: "societyer-local-workspace-second", workspaceId: "workspace-second" },
);
assert.equal(
  (await desktopWorkspaceDatabaseBinding(runtime, { bridge: bridge(secondWorkspace), storage })).databaseName,
  "societyer-local-workspace-second",
);
assert.equal(storage.getItem(bindingKey), null);

// Upgrade: Electron's durable workspace marker binds existing data to its real owner.
assert.deepEqual(
  await desktopWorkspaceDatabaseBinding(runtime, { bridge: bridge(originalWorkspace), storage }),
  { databaseName: legacyDatabaseName, workspaceId: "workspace-original" },
);
assert.equal(storage.getItem(bindingKey), "workspace-original");

// A newly chosen folder on the first upgraded run cannot steal the legacy database.
assert.deepEqual(
  await desktopWorkspaceDatabaseBinding(runtime, { bridge: bridge(secondWorkspace), storage }),
  { databaseName: "societyer-local-workspace-second", workspaceId: "workspace-second" },
);

// Repeated switches remain stable in both directions.
for (let index = 0; index < 3; index += 1) {
  assert.equal(
    (await desktopWorkspaceDatabaseBinding(runtime, { bridge: bridge(originalWorkspace), storage })).databaseName,
    legacyDatabaseName,
  );
  assert.equal(
    (await desktopWorkspaceDatabaseBinding(runtime, { bridge: bridge(secondWorkspace), storage })).databaseName,
    "societyer-local-workspace-second",
  );
}

// Clearing renderer storage does not matter when the owner marker survives in workspace.json.
storage.clear();
assert.equal(
  (await desktopWorkspaceDatabaseBinding(runtime, { bridge: bridge(secondWorkspace), storage })).databaseName,
  "societyer-local-workspace-second",
);
assert.equal(storage.getItem(bindingKey), null);
assert.equal(
  (await desktopWorkspaceDatabaseBinding(runtime, { bridge: bridge(originalWorkspace), storage })).databaseName,
  legacyDatabaseName,
);
assert.equal(storage.getItem(bindingKey), "workspace-original");

// Even if a different folder opens first in a separate/reset profile, it cannot claim legacy data.
const resetStorage = new StubStorage();
assert.equal(
  (await desktopWorkspaceDatabaseBinding(runtime, {
    bridge: bridge(secondWorkspace),
    storage: resetStorage,
  })).databaseName,
  "societyer-local-workspace-second",
);
assert.equal(
  (await desktopWorkspaceDatabaseBinding(runtime, {
    bridge: bridge(originalWorkspace),
    storage: resetStorage,
  })).databaseName,
  legacyDatabaseName,
);

// An earlier localStorage binding remains authoritative if the durable migration runs later.
storage.setItem(bindingKey, originalWorkspace.id);
assert.equal(
  (await desktopWorkspaceDatabaseBinding(runtime, {
    bridge: bridge({ ...secondWorkspace, legacyDexieWorkspace: true }),
    storage,
  })).databaseName,
  "societyer-local-workspace-second",
);

// Missing or failed bridge identity fails closed instead of opening the legacy database.
await assert.rejects(
  desktopWorkspaceDatabaseBinding(runtime, { storage }),
  /requires the Electron bridge/,
);
await assert.rejects(
  desktopWorkspaceDatabaseBinding(runtime, { bridge: bridge(null), storage }),
  /requires a workspace ID/,
);
await assert.rejects(
  desktopWorkspaceDatabaseBinding(runtime, {
    bridge: bridge(null, new Error("bridge unavailable")),
    storage,
  }),
  /bridge unavailable/,
);

// IDs that previously slugified to the same suffix now receive distinct database names.
const collisionA = await desktopWorkspaceDatabaseBinding(runtime, {
  bridge: bridge({ id: "team/a" }),
  storage,
});
const collisionB = await desktopWorkspaceDatabaseBinding(runtime, {
  bridge: bridge({ id: "team?a" }),
  storage,
});
assert.notEqual(collisionA.workspaceId, collisionB.workspaceId);
assert.notEqual(collisionA.databaseName, collisionB.databaseName);

console.log("Local workspace database binding checks passed.");
