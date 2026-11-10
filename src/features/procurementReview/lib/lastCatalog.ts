/**
 * The catalog this device last saw, per workspace and folder: its generation,
 * publication time and counts (no notice data). The hosted page starts its
 * first queries from it while the live catalog is read, instead of waiting a
 * round trip for the generation. Nothing it returns is shown as fact until
 * the live catalog confirms it (convexSource.ts `confirmed`).
 */
import type { ReaderCatalog } from "../reader/source";

const key = (societyId: string, folder: string) => `societyer:procurement-review:catalog:${societyId}:${folder}`;

function valid(value: unknown): value is ReaderCatalog {
  if (!value || typeof value !== "object") return false;
  const { generation, publishedAt, counts } = value as Record<string, unknown>;
  return typeof generation === "string" && generation.length > 0 && generation.length < 200
    && typeof publishedAt === "string"
    && !!counts && typeof counts === "object" && !Array.isArray(counts)
    && Object.values(counts).every((count) => typeof count === "number" && Number.isFinite(count));
}

export function readLastCatalog(societyId: string, folder: string): ReaderCatalog | null {
  try {
    const raw = window.localStorage.getItem(key(societyId, folder));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return valid(parsed) ? { generation: parsed.generation, publishedAt: parsed.publishedAt, counts: parsed.counts } : null;
  } catch {
    // Private windows and blocked storage simply start without it.
    return null;
  }
}

/** Remember the live catalog, or forget it when there is none (nothing published, an import running, the folder changed). */
export function rememberCatalog(societyId: string, folder: string, catalog: ReaderCatalog | null) {
  try {
    if (catalog) window.localStorage.setItem(key(societyId, folder), JSON.stringify({ generation: catalog.generation, publishedAt: catalog.publishedAt, counts: catalog.counts }));
    else window.localStorage.removeItem(key(societyId, folder));
  } catch {
    // Not remembering only costs the next visit a round trip.
  }
}
