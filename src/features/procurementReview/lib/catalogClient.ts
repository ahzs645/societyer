/** The page's side of the catalog worker. */
import type { CatalogMethod } from "./readOnlyCatalog";
import type { CatalogWorkerRequest, CatalogWorkerResponse } from "./workerProtocol";

export type CatalogClient = {
  call(method: CatalogMethod, input?: unknown): Promise<unknown>;
  close(): void;
};

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type Unsent = CatalogWorkerRequest extends infer Request ? Request extends unknown ? Omit<Request, "id"> : never : never;

/** Opens the verified catalog in a worker. The bytes are moved, not copied, so the page stops holding them. */
export async function openCatalogWorker(catalog: Uint8Array): Promise<CatalogClient> {
  const worker = new Worker(new URL("./catalog.worker.ts", import.meta.url), { type: "module", name: "societyer-procurement-catalog" });
  const pending = new Map<number, Pending>();
  let nextId = 0;
  let failure: Error | null = null;

  const failAll = (error: Error) => {
    failure = error;
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  worker.onmessage = (event: MessageEvent<CatalogWorkerResponse>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.type === "result") entry.resolve(message.result);
    else entry.reject(new Error(message.message));
  };
  worker.onerror = (event) => {
    event.preventDefault();
    failAll(new Error(event.message || "The catalog worker stopped."));
  };

  const send = (request: Unsent, transfer: Transferable[] = []) => new Promise<unknown>((resolve, reject) => {
    if (failure) return reject(failure);
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...request, id } as CatalogWorkerRequest, transfer);
  });

  const buffer = catalog.byteOffset === 0 && catalog.byteLength === catalog.buffer.byteLength ? catalog.buffer : catalog.slice().buffer;
  try {
    await send({ type: "open", catalog: buffer as ArrayBuffer }, [buffer]);
  } catch (error) {
    worker.terminate();
    throw error;
  }
  return {
    call: (method, input) => send({ type: "call", method, input }),
    close: () => {
      failAll(new Error("The catalog was closed."));
      worker.terminate();
    },
  };
}
