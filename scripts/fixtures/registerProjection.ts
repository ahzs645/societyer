/** Synthetic records shared by native and isolated live qualification only. */
export async function seedRegisterProjection(ctx: any, societyId: any, marker: string) {
  const created: string[] = [];
  const put = async (table: string, row: any) => {
    const id = await ctx.db.insert(table, { societyId, ...row }); created.push(id); return id;
  };
  const at = new Date().toISOString();
  const publicDocument = await put("documents", { title: `${marker} readable document`, category: "Minutes", tags: ["public"], flaggedForDeletion: false, createdAtISO: at });
  const restrictedDocument = await put("documents", { title: `${marker} restricted source`, category: "Other", tags: [], flaggedForDeletion: false, createdAtISO: at });
  const meeting = await put("meetings", { title: `${marker} readable meeting`, type: "Board", scheduledAt: at, electronic: false, status: "Scheduled", attendeeIds: [] });
  await put("meetingMaterials", { meetingId: meeting, documentId: restrictedDocument, order: 0, requiredForMeeting: false, accessLevel: "restricted", accessGrants: [], availabilityStatus: "available", createdAtISO: at });
  const spine = await put("minuteBookItems", { title: `${marker} readable spine`, recordType: "document", status: "Current", documentIds: [publicDocument], signatureIds: [], sourceEvidenceIds: [], createdAtISO: at, updatedAtISO: at });
  const filing = await put("filings", { kind: `${marker} forbidden filing`, dueDate: "2099-01-01", status: "Draft" });
  const financial = await put("financials", { fiscalYear: `${marker} forbidden financial`, periodEnd: "2026-12-31", revenueCents: 100, expensesCents: 50, netAssetsCents: 50, auditStatus: "Draft", remunerationDisclosures: [], presentedAtMeetingId: meeting });
  const proxy = await put("proxies", { meetingId: meeting, grantorName: `${marker} forbidden proxy`, proxyHolderName: "Synthetic", signedAtISO: at });
  const assignment = await put("boardRoleAssignments", { personName: `${marker} forbidden director`, roleTitle: "Director", roleType: "observed", startDate: "2026-01-01", status: "Observed", confidence: "Review", createdAtISO: at });
  const budgets: string[] = [], lines: string[] = [], statements: string[] = [], statementLines: string[] = [], evidence: string[] = [];
  for (const [suffix, document] of [["readable", publicDocument], ["restricted source", restrictedDocument]]) {
    const snapshot = await put("budgetSnapshots", { title: `${marker} ${suffix} budget`, fiscalYear: "2026", currency: "CAD", status: "NeedsReview", confidence: "Review", sourceDocumentIds: [document], createdAtISO: at });
    const statement = await put("financialStatementImports", { title: `${marker} ${suffix} statement`, fiscalYear: "2026", statementType: "income_statement", periodEnd: "2026-12-31", status: "NeedsReview", confidence: "Review", sourceDocumentIds: [document], createdAtISO: at });
    statements.push(statement);
    statementLines.push(await put("financialStatementImportLines", { statementImportId: statement, section: "income", label: `${marker} ${suffix} statement detail`, confidence: "Review" }));
    budgets.push(snapshot);
    lines.push(await put("budgetSnapshotLines", { snapshotId: snapshot, lineType: "expense", category: `${marker} ${suffix} budget detail`, confidence: "Review" }));
    evidence.push(await put("sourceEvidence", { sourceDocumentId: document, externalSystem: "Synthetic", sourceTitle: `${marker} ${suffix} evidence`, evidenceKind: "provenance", sensitivity: "standard", accessLevel: "internal", summary: `${marker} ${suffix} evidence notes`, status: "NeedsReview", createdAtISO: at }));
    await put("signingAuthorities", { personName: `${marker} ${suffix} signer`, authorityType: "signing", effectiveDate: "2026-01-01", status: "NeedsReview", confidence: "Review", sourceDocumentIds: [document], createdAtISO: at });
  }
  return { created, marker, meeting, publicDocument, restrictedDocument, spine, filing, financial, proxy, assignment, budgets, lines, statements, statementLines, evidence };
}
