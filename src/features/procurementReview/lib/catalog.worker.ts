/** Procurement review catalog worker: holds the snapshot in wa-sqlite and answers catalog reads off the main thread. */
import wasmUrl from "@journeyapps/wa-sqlite/dist/wa-sqlite.wasm?url";
import { openCatalogDatabase } from "./catalogSql";
import { ReadOnlyCatalog } from "./readOnlyCatalog";
import type { CatalogWorkerRequest, CatalogWorkerResponse } from "./workerProtocol";

type WorkerScope = { postMessage: (message: CatalogWorkerResponse) => void; onmessage: ((event: MessageEvent<CatalogWorkerRequest>) => void) | null };
const scope = self as unknown as WorkerScope;

let catalog: Promise<ReadOnlyCatalog> | null = null;

async function handle(message: CatalogWorkerRequest): Promise<unknown> {
  if (message.type === "open") {
    if (catalog) throw new Error("The catalog is already open.");
    catalog = openCatalogDatabase(new Uint8Array(message.catalog), { locateFile: () => wasmUrl }).then(ReadOnlyCatalog.open);
    await catalog;
    return { opened: true };
  }
  if (!catalog) throw new Error("The catalog isn't open.");
  return (await catalog).call(message.method, message.input);
}

scope.onmessage = (event) => {
  const message = event.data;
  handle(message).then(
    (result) => scope.postMessage({ type: "result", id: message.id, result }),
    (error: unknown) => scope.postMessage({ type: "error", id: message.id, message: error instanceof Error ? error.message : "The catalog request failed." }),
  );
};
