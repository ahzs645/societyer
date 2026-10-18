/** Messages between the procurement review page and its catalog worker. */
import type { CatalogMethod } from "./readOnlyCatalog";

export type CatalogWorkerRequest =
  | { type: "open"; id: number; catalog: ArrayBuffer }
  | { type: "call"; id: number; method: CatalogMethod; input: unknown };

export type CatalogWorkerResponse =
  | { type: "result"; id: number; result: unknown }
  | { type: "error"; id: number; message: string };
