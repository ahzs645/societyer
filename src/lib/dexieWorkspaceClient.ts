import { StaticConvexClient, type StaticDemoSeed } from "./staticConvex";
import type { LocalWorkspaceSnapshot } from "./localDexieRowStore";

export class DexieWorkspaceClient extends StaticConvexClient {
  constructor(options?: { databaseName?: string; seed?: StaticDemoSeed }) {
    super({
      databaseName: options?.databaseName,
      seed: options?.seed ?? {},
      url: "dexie://societyer-workspace",
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
