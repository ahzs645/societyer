import type { RegistryFileText } from "./extractCore";

/** Messages between the registry import drawer and its extraction worker. */
export type RegistryExtractRequest = { files: Array<{ id: string; name: string; bytes: ArrayBuffer }> };

export type RegistryExtractResponse =
  | { type: "progress"; done: number; total: number }
  | { type: "result"; files: RegistryFileText[] }
  | { type: "error"; message: string };
