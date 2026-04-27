// Applies the active Over the Edge bylaw-rule interpretation from the
// July 5, 2024 filed bylaws already staged in bylaw history.
//
// Run: node scripts/apply-ote-bylaw-rules.mjs

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { config } from "dotenv";
import path from "node:path";

config({ path: path.join(process.cwd(), ".env.local"), quiet: true });

const api = anyApi;
const SOCIETY_NAME = "Over the Edge Newspaper Society";
const EFFECTIVE_FROM_ISO = "2024-07-05T18:28:00.000Z";
const DRY_RUN = process.argv.includes("--dry-run");

const url =
  process.env.VITE_CONVEX_URL ??
  process.env.CONVEX_SELF_HOSTED_URL ??
  process.env.CONVEX_URL;

if (!url) {
  throw new Error("Missing VITE_CONVEX_URL / CONVEX_SELF_HOSTED_URL / CONVEX_URL.");
}

const client = new ConvexHttpClient(url);
const societies = await client.query(api.society.list, {});
const society = societies.find((row) => row.name === SOCIETY_NAME);
if (!society) throw new Error(`Society not found: ${SOCIETY_NAME}`);

const amendments = await client.query(api.bylawAmendments.list, {
  societyId: society._id,
});
const sourceAmendment = amendments.find((row) =>
  (row.sourceExternalIds ?? []).includes("bc-registry-2024-bylaws"),
) ?? amendments.find((row) => row.title === "2024 filed bylaws");

const active = await client.query(api.bylawRules.getActive, {
  societyId: society._id,
});

const payload = {
  societyId: society._id,
  effectiveFromISO: EFFECTIVE_FROM_ISO,
  sourceAmendmentId: sourceAmendment?._id,
  generalNoticeMinDays: 14,
  generalNoticeMaxDays: 60,
  allowElectronicMeetings: true,
  allowHybridMeetings: true,
  allowElectronicVoting: false,
  allowProxyVoting: false,
  proxyHolderMustBeMember: false,
  proxyLimitPerGrantorPerMeeting: 1,
  quorumType: "percentage",
  quorumValue: 10,
  quorumMinimumCount: 3,
  memberProposalThresholdPct: 5,
  memberProposalMinSignatures: 1,
  memberProposalLeadDays: 7,
  requisitionMeetingThresholdPct: 10,
  annualReportDueDaysAfterMeeting: 30,
  requireAgmFinancialStatements: true,
  requireAgmElections: true,
  ballotIsAnonymous: true,
  voterMustBeMemberAtRecordDate: true,
  inspectionMemberRegisterByMembers: true,
  inspectionMemberRegisterByPublic: false,
  inspectionDirectorRegisterByMembers: true,
  inspectionCopiesAllowed: true,
  ordinaryResolutionThresholdPct: 50,
  specialResolutionThresholdPct: 66.67,
  unanimousWrittenSpecialResolution: true,
};

const alreadyApplied =
  !active.isFallback &&
  active.effectiveFromISO === payload.effectiveFromISO &&
  active.sourceAmendmentId === payload.sourceAmendmentId &&
  active.quorumType === payload.quorumType &&
  active.quorumValue === payload.quorumValue &&
  active.quorumMinimumCount === payload.quorumMinimumCount &&
  active.allowProxyVoting === payload.allowProxyVoting;

if (alreadyApplied) {
  console.log(`OTE bylaw rules already active as v${active.version}.`);
  process.exit(0);
}

console.log(
  `${DRY_RUN ? "Dry run: would apply" : "Applying"} OTE bylaw rules for ${society.name}`,
);
console.log(
  JSON.stringify(
    {
      societyId: society._id,
      sourceAmendment: sourceAmendment
        ? { id: sourceAmendment._id, title: sourceAmendment.title }
        : null,
      previousActive: active.isFallback
        ? { fallback: true, quorumType: active.quorumType, quorumValue: active.quorumValue }
        : {
            version: active.version,
            effectiveFromISO: active.effectiveFromISO,
            quorumType: active.quorumType,
            quorumValue: active.quorumValue,
            quorumMinimumCount: active.quorumMinimumCount,
          },
      next: {
        effectiveFromISO: payload.effectiveFromISO,
        quorum: "3 voting members or 10% of voting members, whichever is greater",
        proxyVoting: "not permitted",
        notice: "14-60 days by Act; 2024 bylaws do not set a shorter notice period",
      },
    },
    null,
    2,
  ),
);

if (!DRY_RUN) {
  const id = await client.mutation(api.bylawRules.upsertActive, payload);
  console.log(`Applied OTE bylaw rules (${id}).`);
}
