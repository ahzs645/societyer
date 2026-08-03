const enforcementVariable = "SOCIETYER_PORTABLE_ACCESS_ENFORCEMENT";
process.env[enforcementVariable] = "1";
process.env.SOCIETYER_STAGE2_TENANCY_SKIP_REPORT = "1";

const { PORTABLE_ACCESS_ENFORCEMENT } = await import("../shared/portable/define");
if (!PORTABLE_ACCESS_ENFORCEMENT) {
  throw new Error(`${enforcementVariable}=1 did not enable portable access enforcement.`);
}

const suites = [
  "check-portable-principal",
  "check-identity-binding",
  "check-static-convex-parity",
  "check-local-snapshot-roundtrip",
  "check-stage2-tenancy",
  "check-accounting-core",
  "check-corporation-equity-ledger",
  "check-create-workspace-onboarding",
  "check-organization-domain",
  "check-meeting-governance",
  "check-document-binding",
  "check-connector-tenancy",
  "check-outbound-url-policy",
  "check-local-workspace-binding",
  "check-persistence-wrappers",
  "check-corporation-document-packets",
  "check-compliance-obligations",
  "check-corporation-mvp-flow",
  "check-post-incorporation-checklist-flow",
  "check-firm-flow",
  "check-org-detail-smoke",
] as const;

console.log(`Stage 2 enforcement readiness: enforcement ON; running ${suites.length} suites.`);
for (const suite of suites) {
  console.log(`\n[enforcement ON] ${suite}`);
  try {
    await import(`./${suite}.ts`);
  } catch (error: unknown) {
    console.error(`[enforcement ON] FAILED: ${suite}`);
    throw error;
  }
}

console.log(`\nStage 2 enforcement readiness passed: ${suites.length}/${suites.length} suites with enforcement ON.`);
