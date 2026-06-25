/**
 * Build a document RenderContext from a society record + its role holders
 * (pure logic). Bridges the persisted shape (societies row + roleHolders rows)
 * to the grammar-aware RenderContext consumed by templates / packet rendering.
 */

import { buildRenderContext, type RenderContext, type RenderContextOrg } from "./renderContext";
import type { Actor } from "./nlg";

/** Minimal society shape this needs (a Convex societies row satisfies it). */
export interface SocietyLike {
  name?: string;
  legalName?: string;
  shortName?: string;
  entityType?: string;
  actFormedUnder?: string;
  jurisdictionCode?: string;
  incorporationNumber?: string;
}

/** Minimal role-holder shape (a Convex roleHolders row satisfies it). */
export interface RoleHolderLike {
  roleType?: string;
  fullName?: string;
  gender?: string;
  startDate?: string | null;
  endDate?: string | null;
}

function toActor(row: RoleHolderLike): Actor {
  const gender = row.gender === "M" || row.gender === "F" || row.gender === "X" ? row.gender : undefined;
  return { name: String(row.fullName ?? ""), gender };
}

/** Role holders of a type that are current (no endDate) — order preserved. */
function actorsOfType(rows: readonly RoleHolderLike[], roleType: string): Actor[] {
  return rows.filter((r) => r.roleType === roleType && !r.endDate).map(toActor);
}

export function buildSocietyRenderContext(
  society: SocietyLike,
  roleHolders: readonly RoleHolderLike[],
  asOfISO: string,
): RenderContext {
  const org: RenderContextOrg = {
    legalName: society.legalName ?? society.name,
    shortName: society.shortName,
    entityType: society.entityType,
    actFormedUnder: society.actFormedUnder,
    jurisdictionCode: society.jurisdictionCode,
    incorporationNumber: society.incorporationNumber,
  };
  return buildRenderContext({
    org,
    directors: actorsOfType(roleHolders, "director"),
    members: actorsOfType(roleHolders, "member"),
    officers: actorsOfType(roleHolders, "officer"),
    asOf: asOfISO,
  });
}
