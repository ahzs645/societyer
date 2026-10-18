/** The snapshot pointer Zoer writes last on every publish (contract §3). */
import { SHA256_PATTERN, SNAPSHOT_ID_PATTERN } from "./paths";

/** Catalog parts and document blobs are split at 7 MiB, under the 8 MiB SharePoint broker cap. */
export const SNAPSHOT_PART_BYTES = 7 * 1024 * 1024;
/** part-NNN allows 1,000 parts; anything near that is not a catalog a browser should open. */
const MAX_PARTS = 1000;
/** The uncompressed catalog is held in memory while it is open. */
export const MAX_CATALOG_BYTES = 1024 * 1024 * 1024;

export type SnapshotPart = { path: string; bytes: number; sha256: string };
export type SnapshotFile = { bytes: number; parts: number };
export type SnapshotManifest = {
  format: "zoer-plugin-snapshot";
  formatVersion: 1;
  pluginId: "bc-bid-monitor";
  pluginVersion: string;
  snapshotId: string;
  publishedAt: string;
  publisher: { zoerVersion?: string; host?: string };
  catalog: { encoding: "gzip"; sha256: string; bytes: number; parts: SnapshotPart[] };
  files: Record<string, SnapshotFile>;
  counts: Record<string, number>;
};

export class SnapshotFormatError extends Error {}

const fail = (message: string): never => { throw new SnapshotFormatError(message); };
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown, max: number) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
const shortText = (value: unknown, max = 200) => typeof value === "string" && value.length <= max && !/[\x00-\x1f]/.test(value);
const partSuffix = (index: number) => String(index).padStart(3, "0");

/** Reject anything this reader was not written for, then return only the fields it knows. */
export function parseSnapshotManifest(value: unknown): SnapshotManifest {
  if (!isRecord(value)) fail("The snapshot manifest is not a JSON object.");
  const input = value as Record<string, unknown>;
  if (input.format !== "zoer-plugin-snapshot") fail("The published folder holds an unknown snapshot format.");
  if (input.formatVersion !== 1) fail(`The snapshot uses format version ${String(input.formatVersion)}, which this Societyer can't read. Update Societyer or republish with a matching Zoer.`);
  if (input.pluginId !== "bc-bid-monitor") fail("The snapshot was published by a different plugin.");
  if (!shortText(input.pluginVersion, 100) || !input.pluginVersion) fail("The snapshot manifest has no plugin version.");
  const snapshotId = input.snapshotId;
  if (typeof snapshotId !== "string" || !SNAPSHOT_ID_PATTERN.test(snapshotId)) fail("The snapshot manifest has an invalid snapshot ID.");
  if (typeof input.publishedAt !== "string" || input.publishedAt.length > 40 || Number.isNaN(Date.parse(input.publishedAt))) fail("The snapshot manifest has an invalid publish time.");

  const publisherInput = isRecord(input.publisher) ? input.publisher : fail("The snapshot manifest has no publisher.");
  const publisher: SnapshotManifest["publisher"] = {};
  for (const key of ["zoerVersion", "host"] as const) {
    const field = (publisherInput as Record<string, unknown>)[key];
    if (field === undefined) continue;
    if (!shortText(field)) fail(`The snapshot publisher ${key} is invalid.`);
    publisher[key] = field as string;
  }

  const catalog = isRecord(input.catalog) ? input.catalog : fail("The snapshot manifest has no catalog.");
  const catalogInput = catalog as Record<string, unknown>;
  if (catalogInput.encoding !== "gzip") fail("The snapshot catalog uses an unsupported encoding.");
  const catalogSha = catalogInput.sha256;
  if (typeof catalogSha !== "string" || !SHA256_PATTERN.test(catalogSha)) fail("The snapshot catalog checksum is invalid.");
  if (!(snapshotId as string).endsWith(`-${(catalogSha as string).slice(0, 12)}`)) fail("The snapshot ID doesn't match its catalog checksum.");
  if (!count(catalogInput.bytes, MAX_CATALOG_BYTES) || catalogInput.bytes === 0) fail("The snapshot catalog size is invalid or too large to open in a browser.");
  const partsInput = catalogInput.parts;
  if (!Array.isArray(partsInput) || !partsInput.length || partsInput.length > MAX_PARTS) fail("The snapshot catalog lists no parts or too many.");
  const parts = (partsInput as unknown[]).map((part, index): SnapshotPart => {
    if (!isRecord(part)) fail("A snapshot catalog part is invalid.");
    const entry = part as Record<string, unknown>;
    const path = `snapshots/${snapshotId}/catalog.part-${partSuffix(index)}`;
    if (entry.path !== path) fail(`Snapshot catalog part ${index + 1} should be ${path}.`);
    if (!count(entry.bytes, SNAPSHOT_PART_BYTES) || entry.bytes === 0) fail(`Snapshot catalog part ${index + 1} has an invalid size.`);
    if (typeof entry.sha256 !== "string" || !SHA256_PATTERN.test(entry.sha256)) fail(`Snapshot catalog part ${index + 1} has an invalid checksum.`);
    return { path, bytes: entry.bytes as number, sha256: entry.sha256 as string };
  });

  const filesInput = isRecord(input.files) ? input.files : fail("The snapshot manifest has no document list.");
  const files: Record<string, SnapshotFile> = {};
  for (const [sha256, file] of Object.entries(filesInput as Record<string, unknown>)) {
    if (!SHA256_PATTERN.test(sha256) || !isRecord(file)) fail("The snapshot document list has an invalid entry.");
    const entry = file as Record<string, unknown>;
    if (!count(entry.bytes, Number.MAX_SAFE_INTEGER) || !count(entry.parts, MAX_PARTS)) fail("The snapshot document list has an invalid size.");
    if (entry.parts === 0 && (entry.bytes as number) > SNAPSHOT_PART_BYTES) fail("A snapshot document is larger than one part but isn't split.");
    if ((entry.parts as number) > 0 && (entry.bytes as number) > (entry.parts as number) * SNAPSHOT_PART_BYTES) fail("A snapshot document is larger than its parts.");
    files[sha256] = { bytes: entry.bytes as number, parts: entry.parts as number };
  }

  const countsInput = isRecord(input.counts) ? input.counts : fail("The snapshot manifest has no record counts.");
  const counts: Record<string, number> = {};
  for (const [kind, total] of Object.entries(countsInput as Record<string, unknown>)) {
    if (!shortText(kind, 100) || !count(total, Number.MAX_SAFE_INTEGER)) fail("The snapshot record counts are invalid.");
    counts[kind] = total as number;
  }

  return {
    format: "zoer-plugin-snapshot", formatVersion: 1, pluginId: "bc-bid-monitor",
    pluginVersion: input.pluginVersion as string, snapshotId: snapshotId as string, publishedAt: input.publishedAt as string, publisher,
    catalog: { encoding: "gzip", sha256: catalogSha as string, bytes: catalogInput.bytes as number, parts },
    files, counts,
  };
}

/** Snapshot-relative paths holding one document blob, in order. */
export function snapshotFilePaths(sha256: string, file: SnapshotFile): string[] {
  if (!SHA256_PATTERN.test(sha256)) throw new SnapshotFormatError("Invalid stored document reference.");
  return file.parts === 0 ? [`files/${sha256}`] : Array.from({ length: file.parts }, (_, index) => `files/${sha256}.part-${partSuffix(index)}`);
}
