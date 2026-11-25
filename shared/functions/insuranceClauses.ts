import type { PortableQueryCtx, PortableMutationCtx } from "../portable/ctx";
import {
  coverageCandidates,
  candidateStatus,
  evidenceSourceIssue,
  validateClause,
  type Clause,
} from "../insuranceClauses";
import { getOwned, principalUserId, requireSocietyMembership } from "./access";
import { requirePermissionPortable } from "./permissions";
import { listPortable } from "./insurance";
import { latestPortable } from "./documentVersions";
import { documentAccessPredicate } from "./documents";

type Origin = {
  societyId: string;
  origin: "procurement" | "agreement";
  originKey: string;
};
type Source = {
  label: string;
  reference: string;
  version: string;
  inputKey?: string;
  publication?: string;
};
type Target = Origin & { id: string; revision: number };
async function access(ctx: PortableQueryCtx, a: Origin, write = false) {
  await requireSocietyMembership(ctx, a.societyId);
  await requirePermissionPortable(
    ctx,
    a.societyId,
    write ? "financials:write" : "financials:read",
  );
  await requirePermissionPortable(ctx, a.societyId, "documents:read");
  if (!a.originKey?.trim() || a.originKey.length > 600)
    throw new Error("Invalid source record.");
  if (a.origin === "agreement") {
    await requirePermissionPortable(
      ctx,
      a.societyId,
      write ? "agreements:write" : "agreements:read",
    );
    await getOwned(ctx, "agreements", a.originKey, a.societyId);
  } else if (a.origin !== "procurement")
    throw new Error("Unknown source module.");
  else if (write)
    await requirePermissionPortable(ctx, a.societyId, "documents:write");
}
function rowsFor(ctx: PortableQueryCtx, a: Origin) {
  if (a.origin === "agreement")
    return ctx.db
      .query("insuranceClauseChecks")
      .withIndex("by_agreement", (q) =>
        q.eq("societyId", a.societyId).eq("agreementId", a.originKey),
      )
      .collect();
  return ctx.db
    .query("insuranceClauseChecks")
    .withIndex("by_origin", (q) =>
      q
        .eq("societyId", a.societyId)
        .eq("origin", a.origin)
        .eq("originKey", a.originKey),
    )
    .collect();
}
async function ownedCheck(ctx: PortableQueryCtx, a: Target) {
  const row = await getOwned(ctx, "insuranceClauseChecks", a.id, a.societyId);
  if (
    row.origin !== a.origin ||
    (row.agreementId ?? row.originKey) !== a.originKey
  )
    throw new Error("Clause not found.");
  if (row.revision !== a.revision)
    throw new Error("This clause changed. Reopen the latest review.");
  return row;
}
async function stamp(policy: any) {
  const text = JSON.stringify([
    policy.status,
    policy.policyNumber,
    policy.namedInsured,
    policy.currency,
    policy.startDate,
    policy.endDate,
    policy.archivedAtISO,
    policy.coverageItems,
    policy.policyExclusions,
    policy.coveredParties,
    policy.coveredLocations,
    policy.claimsMadeTerms,
    policy.additionalInsureds,
    policy.certificatesOfInsurance,
    policy.amendments,
    policy.sourceDocumentIds,
    policy.updatedAtISO,
  ]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function readChecks(ctx: PortableQueryCtx, a: Origin) {
  await access(ctx, a);
  const rows = await rowsFor(ctx, a);
  if (!rows.length) return [];
  const policies = await listPortable(ctx, { societyId: a.societyId });
  const canReadDocument = await documentAccessPredicate(ctx, a.societyId);
  return Promise.all(
    rows.map(async (row) => {
      const candidates = coverageCandidates(row.clause, policies);
      let status = row.clause.coverageCode
        ? candidateStatus(candidates)
        : "Coverage type needs review";
      let proof;
      if (row.proof) {
        status = "Review evidence again";
        const p = policies.find((p) => p._id === row.proof.policyId);
        const doc = await ctx.db.get(row.proof.documentId, "documents");
        if (doc?.societyId === a.societyId && canReadDocument(doc)) {
          const version = await latestPortable(ctx, { documentId: doc._id });
          proof = { ...row.proof, documentTitle: doc.title || doc.fileName };
          if (
            p &&
            row.proof.stamp === (await stamp(p)) &&
            candidates.some(
              (c) =>
                c.policyId === p._id &&
                c.lineId === row.proof.lineId &&
                !c.issues.length &&
                !c.below,
            ) &&
            version && version._id === proof.versionId &&
            !evidenceSourceIssue(row.clause.kind, p, proof.lineId, doc._id, version)
          )
            status = "Evidence confirmed";
        }
      }
      return {
        _id: row._id,
        clause: row.clause,
        source: row.source,
        revision: row.revision,
        status,
        candidates,
        proof,
      };
    }),
  );
}
export async function saveCheck(
  ctx: PortableMutationCtx,
  a: Origin & {
    source: Source;
    clause: Clause;
    id?: string;
    revision?: number;
  },
) {
  await access(ctx, a, true);
  validateClause(a.clause);
  if (
    !a.source.label.trim() ||
    !a.source.reference.trim() ||
    a.source.label.length > 400 ||
    a.source.reference.length > 1600 ||
    a.source.version.length > 256 ||
    (a.source.inputKey?.length ?? 0) > 600 ||
    (a.source.publication?.length ?? 0) > 256
  )
    throw new Error("Give the original source and a page or section.");
  const reviewedBy = await principalUserId(ctx, a.societyId);
  const data = {
    source: a.source,
    clause: a.clause,
    reviewedBy,
    reviewedAt: new Date().toISOString(),
  };
  if (a.id) {
    const row = await ownedCheck(ctx, {
      ...a,
      id: a.id,
      revision: a.revision ?? -1,
    });
    await ctx.db.patch(a.id, {
      ...data,
      revision: row.revision + 1,
      proof: undefined,
    });
    return a.id;
  }
  const previous = (await rowsFor(ctx, a)).find(
    (row) =>
      row.source.reference === a.source.reference &&
      row.source.label === a.source.label &&
      row.source.version === a.source.version &&
      row.source.inputKey === a.source.inputKey &&
      Object.entries(a.clause).every(([key, v]) => row.clause[key] === v) &&
      row.clause.minimumCents === a.clause.minimumCents,
  );
  if (previous) return previous._id;
  return ctx.db.insert("insuranceClauseChecks", {
    societyId: a.societyId,
    origin: a.origin,
    ...(a.origin === "agreement"
      ? { agreementId: a.originKey }
      : { originKey: a.originKey }),
    ...data,
    revision: 1,
  });
}
export async function confirmCheck(
  ctx: PortableMutationCtx,
  a: Target & {
    policyId: string;
    lineId: string;
    documentId: string;
    versionId: string;
    citation: string;
    wording: string;
  },
) {
  await access(ctx, a, true);
  const row = await ownedCheck(ctx, a);
  const policy = await getOwned(
    ctx,
    "insurancePolicies",
    a.policyId,
    a.societyId,
  );
  const candidate = coverageCandidates(row.clause, [policy]).find(
    (c) => c.lineId === a.lineId && !c.issues.length && !c.below,
  );
  if (!candidate)
    throw new Error("The policy line no longer matches these tests.");
  if (!policy.sourceDocumentIds?.includes(a.documentId))
    throw new Error("Choose an original linked to this policy term.");
  await getOwned(ctx, "documents", a.documentId, a.societyId);
  const version = await latestPortable(ctx, { documentId: a.documentId });
  if (!version || version._id !== a.versionId)
    throw new Error(
      "Open the current document version and review its wording.",
    );
  const issue = evidenceSourceIssue(row.clause.kind, policy, a.lineId, a.documentId, version);
  if (issue) throw new Error(issue);
  if (
    !a.citation.trim() ||
    !a.wording.trim() ||
    a.citation.length > 300 ||
    a.wording.length > 3000
  )
    throw new Error("Record a page or section and the supporting wording.");
  if (
    (row.clause.kind === "certificate" ||
      row.clause.kind === "additionalInsured") &&
    !a.wording.toLowerCase().includes(row.clause.beneficiary.toLowerCase())
  )
    throw new Error("Quote the wording that names the required party.");
  if (
    row.clause.kind === "additionalInsured" &&
    (!/additional(?:ly)?[ -]insured/i.test(a.wording) ||
      /\b(?:not|no|unless|if required)\b[^.;\n]{0,80}additional[ -]insured|additional[ -]insured[^.;\n]{0,40}\b(?:only if|unless)\b/i.test(
        a.wording,
      ))
  )
    throw new Error(
      "Quote the endorsement granting additional-insured status.",
    );
  await ctx.db.patch(a.id, {
    revision: row.revision + 1,
    proof: {
      policyId: a.policyId,
      lineId: a.lineId,
      documentId: a.documentId,
      versionId: a.versionId,
      citation: a.citation.trim(),
      wording: a.wording.trim(),
      stamp: await stamp(policy),
      confirmedAt: new Date().toISOString(),
      confirmedBy: await principalUserId(ctx, a.societyId),
    },
  });
}
