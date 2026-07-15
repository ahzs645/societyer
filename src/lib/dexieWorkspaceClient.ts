import { StaticConvexClient, type StaticDemoSeed } from "./staticConvex";
import type { LocalWorkspaceSnapshot } from "./localDexieRowStore";

export class DexieWorkspaceClient extends StaticConvexClient {
  constructor(options?: { databaseName?: string; seed?: StaticDemoSeed; workspaceId?: string }) {
    const workspaceId = options?.workspaceId ?? options?.databaseName ?? "workspace";
    super({
      databaseName: options?.databaseName,
      seed: options?.seed ?? {},
      url: "dexie://societyer-workspace",
      principalProvider: () => ({
        kind: "user",
        runtime: "electron-local",
        assurance: "trusted-workspace",
        subject: `local:${workspaceId}`,
      }),
    });
  }

  reseedWorkspace() {
    return this.reseedStaticDemo();
  }

  exportWorkspaceBundle() {
    return this.exportLocalWorkspaceSnapshot();
  }

  importWorkspaceBundle(snapshot: LocalWorkspaceSnapshot) {
    return this.importLocalWorkspaceSnapshot(snapshot);
  }
}
