/**
 * Portable runtime SDK — the domain-agnostic seam that lets one Convex handler
 * run on hosted Convex, browser-local (Dexie), and Electron-local.
 *
 * Nothing here imports Convex, Dexie, or Societyer domain code. This package is
 * intended to be lifted into a reusable internal SDK across Convex-first
 * projects (see docs/portable-functions-architecture.md, "Multi-project").
 */

export type {
  PortableDoc,
  RuntimeKind,
  PortablePrincipal,
  TableName,
  IndexRangeBuilder,
  PaginationOptions,
  PaginationResult,
  PortableQuery,
  PortableDbReader,
  PortableDbWriter,
  TransactionalDb,
  PortableQueryCtx,
  PortableMutationCtx,
} from "./ctx";

export {
  CapabilityUnavailableError,
  isCapabilityUnavailable,
  makeCapabilities,
} from "./capabilities";
export type {
  CapabilityKey,
  CapabilityErrorShape,
  PortableCapabilities,
  EmailCapability,
  SmsCapability,
  StorageCapability,
  LlmCapability,
} from "./capabilities";

export {
  createEntityIdFactory,
  mintEntityId,
  looksLikeEntityId,
  EntityIdMap,
} from "./ids";
export type { EntityIdFactory, EntityIdFactoryOptions } from "./ids";

export { MemoryDb, evaluateQuery, matchesConstraints } from "./memoryDb";
export type { MemoryDbOptions } from "./memoryDb";

export { LocalStoreDb, MemoryRowStore } from "./localRowStore";
export type { LocalRowStore, RowStoreOp, LocalStoreDbOptions } from "./localRowStore";

export {
  definePortableQuery,
  definePortableMutation,
  PortableRuntime,
} from "./define";
export type {
  PortableQueryDef,
  PortableMutationDef,
  PortableFunctionDef,
  PortableRuntimeOptions,
  PortableAccess,
} from "./define";
