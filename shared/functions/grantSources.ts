/**
 * PORTABLE FUNCTIONS: the grant-sources domain (library + workspace reads, and
 * the manual candidate queue mutations).
 *
 * Reads/writes the `grantSources`, `grantSourceProfiles`, and
 * `grantOpportunityCandidates` tables via `ctx.db`, joined against the
 * dependency-free built-in source library. Each handler runs unchanged on hosted
 * Convex, the local Dexie runtime, and the convex-test oracle.
 *
 * Role-gated writes (upsert / addFromLibrary), the internal recorder
 * (_recordDiscoveredCandidates), and the network discovery action
 * (discoverFromSource) stay on Convex — they need `requireRole`, internal*
 * registration, or `fetch`, none of which belong in a portable handler.
 */

import { BUILT_IN_GRANT_SOURCE_PROFILES, BUILT_IN_GRANT_SOURCES } from "../grantSourceLibrary";
import { cleanText } from "./text";
import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

const BUILT_IN_SOURCES = BUILT_IN_GRANT_SOURCES;
const BUILT_IN_PROFILES = BUILT_IN_GRANT_SOURCE_PROFILES;

export async function libraryPortable(_ctx: PortableQueryCtx, _args: Record<string, never>) {
  return BUILT_IN_SOURCES.map((source) => ({
    ...source,
    builtIn: true,
    profile: BUILT_IN_PROFILES.find((profile) => profile.libraryKey === source.libraryKey),
  }));
}

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const [sources, profiles, candidates] = await Promise.all([
    ctx.db
      .query("grantSources")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("grantSourceProfiles")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("grantOpportunityCandidates")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
  ]);
  const profileBySource = new Map(profiles.map((profile: Record<string, any>) => [String(profile.sourceId), profile]));
  const candidateCountBySource = new Map<string, number>();
  for (const candidate of candidates) {
    if (!candidate.sourceId) continue;
    const key = String(candidate.sourceId);
    candidateCountBySource.set(key, (candidateCountBySource.get(key) ?? 0) + 1);
  }
  return sources
    .map((source: Record<string, any>) => ({
      ...source,
      builtIn: false,
      profile: profileBySource.get(String(source._id)),
      candidateCount: candidateCountBySource.get(String(source._id)) ?? 0,
    }))
    .sort((a: any, b: any) => `${a.status}:${a.name}`.localeCompare(`${b.status}:${b.name}`));
}

export async function listWithLibraryPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const installed = await ctx.db
    .query("grantSources")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const installedKeys = new Set(installed.map((source: Record<string, any>) => source.libraryKey).filter(Boolean));
  const installedByKey = new Map<string, any>(installed.map((source: Record<string, any>) => [source.libraryKey, source]));
  const libraryRows = BUILT_IN_SOURCES.map((source) => ({
    ...source,
    _id: installedByKey.get(source.libraryKey)?._id,
    builtIn: true,
    installed: installedKeys.has(source.libraryKey),
    profile: BUILT_IN_PROFILES.find((profile) => profile.libraryKey === source.libraryKey),
  }));
  return { library: libraryRows, workspace: installed };
}

export async function getSourcePortable(ctx: PortableQueryCtx, { sourceId }: { sourceId: string }) {
  const source = await ctx.db.get(sourceId);
  if (!source) return null;
  const profile = (
    await ctx.db
      .query("grantSourceProfiles")
      .withIndex("by_source", (q: any) => q.eq("sourceId", sourceId))
      .collect()
  )[0];
  return { ...source, profile };
}

export async function candidatesPortable(
  ctx: PortableQueryCtx,
  { societyId, sourceId }: { societyId: string; sourceId?: string },
) {
  const rows = sourceId
    ? await ctx.db
        .query("grantOpportunityCandidates")
        .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
        .collect()
    : await ctx.db
        .query("grantOpportunityCandidates")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect();
  return rows
    .filter((row: any) => row.societyId === societyId)
    .sort((a: any, b: any) => (a.applicationDueDate ?? "").localeCompare(b.applicationDueDate ?? ""));
}

// Manually add a grant opportunity to the review queue. The automated scraping
// engine (grantSourceProfiles) is a separate, larger effort; this lets a user
// populate and triage candidates by hand so the queue is functional today.
export async function createCandidatePortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    sourceId?: string;
    title: string;
    funder?: string;
    program?: string;
    opportunityUrl?: string;
    applicationDueDate?: string;
    amountText?: string;
    eligibilityText?: string;
    description?: string;
  },
) {
  const now = new Date().toISOString();
  return await ctx.db.insert("grantOpportunityCandidates", {
    societyId: args.societyId,
    sourceId: args.sourceId,
    title: args.title.trim(),
    funder: cleanText(args.funder),
    program: cleanText(args.program),
    opportunityUrl: cleanText(args.opportunityUrl),
    applicationDueDate: cleanText(args.applicationDueDate),
    amountText: cleanText(args.amountText),
    eligibilityText: cleanText(args.eligibilityText),
    description: cleanText(args.description),
    confidence: "high", // manual entry
    status: "New",
    sourceExternalIds: [],
    createdAtISO: now,
    updatedAtISO: now,
  });
}

export async function setCandidateStatusPortable(
  ctx: PortableMutationCtx,
  { candidateId, status }: { candidateId: string; status: string },
) {
  await ctx.db.patch(candidateId, { status, updatedAtISO: new Date().toISOString() });
  return candidateId;
}
