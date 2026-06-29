// Import-session payload normalization, including insurance-policy dedupe/merge.

import {
  SECTION_RECORD_KINDS,
} from "./importSessionConstants";
import {
  arrayOf,
  cleanDate,
  cleanDateTime,
  cleanText,
  compactRecord,
  compactStrings,
  numberOrUndefined,
  optionalBoolean,
  unique,
} from "./importSessionUtils";
import {
  compactKey,
} from "./importSessionValidation";
import {
  confidenceFor,
} from "./importSessionRecordKinds";

function normalizePayload(recordKind: string, payload: any) {
  if (recordKind === "source") return normalizeSourcePayload(payload);
  if (recordKind === "motion") return normalizeMotionPayload(payload);
  if (recordKind === "meetingMinutes") return normalizeMeetingMinutesPayload(payload);
  if (recordKind === "budget") return normalizeBudgetPayload(payload);
  if (SECTION_RECORD_KINDS.includes(recordKind as any)) return normalizeSectionPayload(payload);
  return { ...(payload ?? {}) };
}

function normalizeSourcePayload(source: any) {
  return {
    externalSystem: cleanText(source?.externalSystem) || "paperless",
    externalId: cleanText(source?.externalId),
    title: cleanText(source?.title),
    sourceDate: cleanText(source?.sourceDate),
    category: cleanText(source?.category) || "Other",
    confidence: confidenceFor(source),
    notes: cleanText(source?.notes),
    url: cleanText(source?.url),
    localPath: cleanText(source?.localPath),
    fileName: cleanText(source?.fileName),
    mimeType: cleanText(source?.mimeType),
    fileSizeBytes: numberOrUndefined(source?.fileSizeBytes),
    sha256: cleanText(source?.sha256),
    sensitivity: cleanText(source?.sensitivity),
    tags: arrayOf(source?.tags).map(String),
  };
}

function normalizeMotionPayload(motion: any) {
  return {
    meetingDate: cleanText(motion?.meetingDate),
    meetingTitle: cleanText(motion?.meetingTitle),
    motionText: cleanText(motion?.motionText),
    outcome: cleanText(motion?.outcome),
    movedByName: cleanText(motion?.movedByName),
    secondedByName: cleanText(motion?.secondedByName),
    votesFor: numberOrUndefined(motion?.votesFor),
    votesAgainst: numberOrUndefined(motion?.votesAgainst),
    abstentions: numberOrUndefined(motion?.abstentions),
    resolutionType: cleanText(motion?.resolutionType),
    voteSummary: cleanText(motion?.voteSummary),
    pageRef: cleanText(motion?.pageRef),
    evidenceText: cleanText(motion?.evidenceText),
    rawText: cleanText(motion?.rawText),
    category: cleanText(motion?.category) || "Governance",
    sourceExternalIds: arrayOf(motion?.sourceExternalIds).map(String),
    notes: cleanText(motion?.notes),
  };
}

function normalizeMeetingMinutesPayload(minutes: any) {
  return {
    meetingDate: cleanText(minutes?.meetingDate),
    meetingTitle: cleanText(minutes?.meetingTitle),
    chairName: cleanText(minutes?.chairName),
    secretaryName: cleanText(minutes?.secretaryName),
    recorderName: cleanText(minutes?.recorderName),
    calledToOrderAt: cleanText(minutes?.calledToOrderAt),
    adjournedAt: cleanText(minutes?.adjournedAt),
    remoteParticipation: normalizeRemoteParticipationPayload(minutes?.remoteParticipation),
    detailedAttendance: normalizeDetailedAttendancePayload(minutes?.detailedAttendance),
    attendees: compactStrings(arrayOf(minutes?.attendees)),
    absent: compactStrings(arrayOf(minutes?.absent)),
    quorumMet: Boolean(minutes?.quorumMet),
    agendaItems: compactStrings(arrayOf(minutes?.agendaItems)),
    discussion: cleanText(minutes?.discussion),
    sections: normalizeMinuteSectionsPayload(minutes?.sections),
    motions: arrayOf(minutes?.motions).map(normalizeMotionPayload),
    decisions: compactStrings(arrayOf(minutes?.decisions)),
    actionItems: arrayOf(minutes?.actionItems).map(normalizeMinutesActionItem).filter(Boolean),
    nextMeetingAt: cleanText(minutes?.nextMeetingAt),
    nextMeetingLocation: cleanText(minutes?.nextMeetingLocation),
    nextMeetingNotes: cleanText(minutes?.nextMeetingNotes),
    sessionSegments: normalizeSessionSegmentsPayload(minutes?.sessionSegments),
    appendices: normalizeAppendicesPayload(minutes?.appendices),
    agmDetails: normalizeAgmDetailsPayload(minutes?.agmDetails),
    sourceExternalIds: arrayOf(minutes?.sourceExternalIds).map(String),
    sourceDocumentTitle: cleanText(minutes?.sourceDocumentTitle),
    sourceDocumentId: minutes?.sourceDocumentId != null ? String(minutes.sourceDocumentId) : undefined,
    sectionIndex: numberOrUndefined(minutes?.sectionIndex),
    pageRef: cleanText(minutes?.pageRef),
    confidence: confidenceFor(minutes),
    notes: cleanText(minutes?.notes),
  };
}

function structuredMinutesPatchFromPayload(payload: any) {
  return compactRecord({
    chairName: cleanText(payload?.chairName),
    secretaryName: cleanText(payload?.secretaryName),
    recorderName: cleanText(payload?.recorderName),
    calledToOrderAt: cleanText(payload?.calledToOrderAt),
    adjournedAt: cleanText(payload?.adjournedAt),
    remoteParticipation: normalizeRemoteParticipationPayload(payload?.remoteParticipation),
    detailedAttendance: normalizeDetailedAttendancePayload(payload?.detailedAttendance),
    sections: normalizeMinuteSectionsPayload(payload?.sections),
    nextMeetingAt: cleanText(payload?.nextMeetingAt),
    nextMeetingLocation: cleanText(payload?.nextMeetingLocation),
    nextMeetingNotes: cleanText(payload?.nextMeetingNotes),
    sessionSegments: normalizeSessionSegmentsPayload(payload?.sessionSegments),
    appendices: normalizeAppendicesPayload(payload?.appendices),
    agmDetails: normalizeAgmDetailsPayload(payload?.agmDetails),
  }) ?? {};
}

function normalizeRemoteParticipationPayload(value: any) {
  if (!value || typeof value !== "object") return undefined;
  return compactRecord({
    url: cleanText(value.url),
    meetingId: cleanText(value.meetingId),
    passcode: cleanText(value.passcode),
    instructions: cleanText(value.instructions),
  });
}

function normalizeDetailedAttendancePayload(value: any) {
  const rows = arrayOf(value)
    .map((row: any) => compactRecord({
      name: cleanText(row?.name),
      status: cleanText(row?.status) || "present",
      roleTitle: cleanText(row?.roleTitle),
      affiliation: cleanText(row?.affiliation),
      memberIdentifier: cleanText(row?.memberIdentifier),
      proxyFor: cleanText(row?.proxyFor),
      quorumCounted: optionalBoolean(row?.quorumCounted),
      notes: cleanText(row?.notes),
    }))
    .filter((row: any) => row?.name);
  return rows.length ? rows : undefined;
}

function normalizeMinuteSectionsPayload(value: any) {
  const rows = arrayOf(value)
    .map((row: any) => compactRecord({
      title: cleanText(row?.title),
      type: cleanText(row?.type),
      presenter: cleanText(row?.presenter),
      discussion: cleanText(row?.discussion),
      reportSubmitted: optionalBoolean(row?.reportSubmitted),
      decisions: arrayOf(row?.decisions).map(String).map(cleanText).filter(Boolean),
      actionItems: normalizeActionItemsPayload(row?.actionItems),
    }))
    .filter((row: any) => row?.title);
  return rows.length ? rows : undefined;
}

function normalizeActionItemsPayload(value: any) {
  const rows = arrayOf(value)
    .map(normalizeMinutesActionItem)
    .filter((row: any) => row?.text);
  return rows.length ? rows : undefined;
}

function normalizeMinutesActionItem(row: any) {
  const text = typeof row === "string" ? cleanText(row) : cleanText(row?.text);
  if (!text) return null;
  return compactRecord({
    text,
    assignee: cleanText(row?.assignee),
    dueDate: cleanText(row?.dueDate),
    done: Boolean(row?.done),
  });
}

function normalizeSessionSegmentsPayload(value: any) {
  const rows = arrayOf(value)
    .map((row: any) => compactRecord({
      type: cleanText(row?.type) || "other",
      title: cleanText(row?.title),
      startedAt: cleanText(row?.startedAt),
      endedAt: cleanText(row?.endedAt),
      notes: cleanText(row?.notes),
    }))
    .filter((row: any) => row?.type);
  return rows.length ? rows : undefined;
}

function normalizeAppendicesPayload(value: any) {
  const rows = arrayOf(value)
    .map((row: any) => compactRecord({
      title: cleanText(row?.title),
      type: cleanText(row?.type),
      reference: cleanText(row?.reference),
      notes: cleanText(row?.notes),
    }))
    .filter((row: any) => row?.title);
  return rows.length ? rows : undefined;
}

function normalizeAgmDetailsPayload(value: any) {
  if (!value || typeof value !== "object") return undefined;
  return compactRecord({
    financialStatementsPresented: optionalBoolean(value.financialStatementsPresented),
    financialStatementsNotes: cleanText(value.financialStatementsNotes),
    directorElectionNotes: cleanText(value.directorElectionNotes),
    directorAppointments: normalizeDirectorAppointmentsPayload(value.directorAppointments),
    specialResolutionExhibits: normalizeSpecialResolutionExhibitsPayload(value.specialResolutionExhibits),
  });
}

function normalizeDirectorAppointmentsPayload(value: any) {
  const rows = arrayOf(value)
    .map((row: any) => compactRecord({
      name: cleanText(row?.name),
      roleTitle: cleanText(row?.roleTitle),
      affiliation: cleanText(row?.affiliation),
      term: cleanText(row?.term),
      consentRecorded: optionalBoolean(row?.consentRecorded),
      votesReceived: numberOrUndefined(row?.votesReceived),
      elected: optionalBoolean(row?.elected),
      status: cleanText(row?.status),
      notes: cleanText(row?.notes),
    }))
    .filter((row: any) => row?.name);
  return rows.length ? rows : undefined;
}

function normalizeSpecialResolutionExhibitsPayload(value: any) {
  const rows = arrayOf(value)
    .map((row: any) => compactRecord({
      title: cleanText(row?.title),
      reference: cleanText(row?.reference),
      notes: cleanText(row?.notes),
    }))
    .filter((row: any) => row?.title);
  return rows.length ? rows : undefined;
}

function normalizeBudgetPayload(budget: any) {
  return {
    ...(budget ?? {}),
    totalIncomeCents: numberOrUndefined(budget?.totalIncomeCents),
    totalExpenseCents: numberOrUndefined(budget?.totalExpenseCents),
    netCents: numberOrUndefined(budget?.netCents),
    endingBalanceCents: numberOrUndefined(budget?.endingBalanceCents),
    lines: arrayOf(budget?.lines),
    sourceExternalIds: arrayOf(budget?.sourceExternalIds).map(String),
  };
}

function normalizeSectionPayload(payload: any) {
  return {
    ...(payload ?? {}),
    sourceExternalIds: arrayOf(payload?.sourceExternalIds).map(String),
    highlights: arrayOf(payload?.highlights).map(String),
    concerns: arrayOf(payload?.concerns).map(String),
    sourceLines: arrayOf(payload?.sourceLines),
    lines: arrayOf(payload?.lines),
    submissionChecklist: arrayOf(payload?.submissionChecklist).map(String),
    interests: arrayOf(payload?.interests).map(String),
    riskFlags: arrayOf(payload?.riskFlags).map(String).map(cleanText).filter(Boolean),
    remunerationDisclosures: arrayOf(payload?.remunerationDisclosures),
    feePaidCents: numberOrUndefined(payload?.feePaidCents),
    coverageCents: numberOrUndefined(payload?.coverageCents),
    premiumCents: numberOrUndefined(payload?.premiumCents),
    deductibleCents: numberOrUndefined(payload?.deductibleCents),
    revenueCents: numberOrUndefined(payload?.revenueCents),
    expensesCents: numberOrUndefined(payload?.expensesCents),
    netAssetsCents: numberOrUndefined(payload?.netAssetsCents),
    restrictedFundsCents: numberOrUndefined(payload?.restrictedFundsCents),
    amountRequestedCents: numberOrUndefined(payload?.amountRequestedCents),
    amountAwardedCents: numberOrUndefined(payload?.amountAwardedCents),
    annualSalaryCents: numberOrUndefined(payload?.annualSalaryCents),
    hourlyWageCents: numberOrUndefined(payload?.hourlyWageCents),
    totalIncomeCents: numberOrUndefined(payload?.totalIncomeCents),
    totalExpenseCents: numberOrUndefined(payload?.totalExpenseCents),
    endingBalanceCents: numberOrUndefined(payload?.endingBalanceCents),
    cashBalanceCents: numberOrUndefined(payload?.cashBalanceCents),
    amountCents: numberOrUndefined(payload?.amountCents),
    policySeriesKey: cleanText(payload?.policySeriesKey),
    policyTermLabel: cleanText(payload?.policyTermLabel),
    versionType: cleanText(payload?.versionType),
    renewalOfPolicyNumber: cleanText(payload?.renewalOfPolicyNumber),
    additionalInsureds: arrayOf(payload?.additionalInsureds).map(String).map(cleanText).filter(Boolean),
    coveredParties: normalizeCoveredParties(payload?.coveredParties),
    coverageItems: normalizeCoverageItems(payload?.coverageItems),
    coveredLocations: normalizeCoveredLocations(payload?.coveredLocations),
    policyDefinitions: normalizePolicyDefinitions(payload?.policyDefinitions),
    declinedCoverages: normalizeDeclinedCoverages(payload?.declinedCoverages),
    certificatesOfInsurance: normalizeCertificatesOfInsurance(payload?.certificatesOfInsurance),
    insuranceRequirements: normalizeInsuranceRequirements(payload?.insuranceRequirements),
    claimsMadeTerms: normalizeClaimsMadeTerms(payload?.claimsMadeTerms),
    claimIncidents: normalizeClaimIncidents(payload?.claimIncidents),
    annualReviews: normalizeAnnualReviews(payload?.annualReviews),
    complianceChecks: normalizeComplianceChecks(payload?.complianceChecks),
  };
}

function dedupeInsurancePolicies(value: unknown[]) {
  const byKey = new Map<string, any>();
  for (const raw of value) {
    const policy = normalizeSectionPayload(raw);
    if (!isImportableInsurancePolicy(policy)) continue;
    const key = insurancePolicyDedupeKey(policy);
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeInsurancePolicies(existing, policy) : policy);
  }
  return Array.from(byKey.values()).sort((a, b) =>
    String(a.policySeriesKey ?? "").localeCompare(String(b.policySeriesKey ?? "")) ||
    String(b.startDate ?? "").localeCompare(String(a.startDate ?? "")),
  );
}

function isImportableInsurancePolicy(policy: any) {
  const policyNumber = cleanText(policy?.policyNumber);
  const insurer = cleanText(policy?.insurer);
  const hasKnownPolicy = Boolean(policyNumber && policyNumber !== "Needs review");
  const hasKnownInsurer = Boolean(insurer && insurer !== "Needs review");
  const hasInsuranceEvidence = Boolean(
    policy?.coverageCents != null ||
    policy?.premiumCents != null ||
    policy?.coverageSummary ||
    arrayOf(policy?.coverageItems).length ||
    arrayOf(policy?.coveredParties).length ||
    arrayOf(policy?.sourceExternalIds).some((id) => /^local:|^paperless:/i.test(String(id))),
  );
  return (hasKnownPolicy || hasKnownInsurer) && hasInsuranceEvidence;
}

function insurancePolicyDedupeKey(policy: any) {
  return compactKey([
    cleanText(policy?.policySeriesKey) || insurancePolicySeriesKey(policy),
    cleanText(policy?.policyNumber),
    cleanDate(policy?.startDate),
    cleanDate(policy?.endDate),
    cleanText(policy?.kind),
  ]);
}

function insurancePolicySeriesKey(policy: any) {
  const kind = cleanText(policy?.kind) || "Other";
  const insurer = cleanText(policy?.insurer);
  const broker = cleanText(policy?.broker);
  const policyNumber = cleanText(policy?.policyNumber);
  if (kind === "GeneralLiability" && policyNumber && policyNumber !== "Needs review") {
    return compactKey(["cgl", insurer, broker, policyNumber]);
  }
  if (kind === "DirectorsOfficers") {
    return compactKey(["dno", insurer, broker, "management-liability"]);
  }
  return compactKey([kind, insurer, broker, policyNumber]);
}

function insurancePolicyTermLabel(policy: any) {
  const start = cleanDate(policy?.startDate);
  const end = cleanDate(policy?.endDate);
  if (start && end) return `${start.slice(0, 4)}-${end.slice(0, 4)}`;
  return start?.slice(0, 4) || cleanDate(policy?.renewalDate)?.slice(0, 4);
}

function mergeInsurancePolicies(existing: any, incoming: any) {
  const merged: any = { ...existing };
  for (const [key, value] of Object.entries(incoming ?? {})) {
    if (value == null || value === "") continue;
    if (Array.isArray(value)) {
      merged[key] = mergeRecordArrays(merged[key], value);
      continue;
    }
    const current = merged[key];
    if (current == null || current === "" || current === "Needs review") {
      merged[key] = value;
    }
  }
  merged.sourceExternalIds = unique([...(existing.sourceExternalIds ?? []), ...(incoming.sourceExternalIds ?? [])]);
  merged.riskFlags = unique([...(existing.riskFlags ?? []), ...(incoming.riskFlags ?? [])]);
  merged.notes = [existing.notes, incoming.notes].map(cleanText).filter(Boolean).filter((note, index, arr) => arr.indexOf(note) === index).join("\n") || undefined;
  return merged;
}

function mergeRecordArrays(a: unknown, b: unknown) {
  const rows = [...arrayOf(a), ...arrayOf(b)];
  const seen = new Set<string>();
  const out: any[] = [];
  for (const row of rows) {
    const key = JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function normalizeCoveredParties(value: unknown) {
  return arrayOf(value)
    .map((party: any) => compactRecord({
      name: cleanText(party?.name),
      partyType: cleanText(party?.partyType),
      coveredClass: cleanText(party?.coveredClass),
      sourceExternalIds: unique(arrayOf(party?.sourceExternalIds)),
      citationId: cleanText(party?.citationId),
      notes: cleanText(party?.notes),
    }))
    .filter((party): party is any => Boolean(party?.name));
}

function normalizeCoverageItems(value: unknown) {
  return arrayOf(value)
    .map((item: any) => compactRecord({
      label: cleanText(item?.label),
      coverageType: cleanText(item?.coverageType),
      coveredClass: cleanText(item?.coveredClass),
      limitCents: numberOrUndefined(item?.limitCents),
      deductibleCents: numberOrUndefined(item?.deductibleCents),
      summary: cleanText(item?.summary),
      sourceExternalIds: unique(arrayOf(item?.sourceExternalIds)),
      citationId: cleanText(item?.citationId),
    }))
    .filter((item): item is any => Boolean(item?.label));
}

function normalizeCoveredLocations(value: unknown) {
  return arrayOf(value)
    .map((location: any) => compactRecord({
      label: cleanText(location?.label),
      address: cleanText(location?.address),
      room: cleanText(location?.room),
      coverageCents: numberOrUndefined(location?.coverageCents),
      sourceExternalIds: unique(arrayOf(location?.sourceExternalIds)),
      citationId: cleanText(location?.citationId),
      notes: cleanText(location?.notes),
    }))
    .filter((location): location is any => Boolean(location?.label));
}

function normalizePolicyDefinitions(value: unknown) {
  return arrayOf(value)
    .map((definition: any) => compactRecord({
      term: cleanText(definition?.term),
      definition: cleanText(definition?.definition),
      sourceExternalIds: unique(arrayOf(definition?.sourceExternalIds)),
      citationId: cleanText(definition?.citationId),
    }))
    .filter((definition): definition is any => Boolean(definition?.term && definition?.definition));
}

function normalizeDeclinedCoverages(value: unknown) {
  return arrayOf(value)
    .map((declined: any) => compactRecord({
      label: cleanText(declined?.label),
      reason: cleanText(declined?.reason),
      offeredLimitCents: numberOrUndefined(declined?.offeredLimitCents),
      premiumCents: numberOrUndefined(declined?.premiumCents),
      declinedAt: cleanDate(declined?.declinedAt),
      sourceExternalIds: unique(arrayOf(declined?.sourceExternalIds)),
      citationId: cleanText(declined?.citationId),
      notes: cleanText(declined?.notes),
    }))
    .filter((declined): declined is any => Boolean(declined?.label));
}

function normalizeCertificatesOfInsurance(value: unknown) {
  return arrayOf(value)
    .map((certificate: any) => compactRecord({
      holderName: cleanText(certificate?.holderName),
      additionalInsuredLegalName: cleanText(certificate?.additionalInsuredLegalName),
      eventName: cleanText(certificate?.eventName),
      eventDate: cleanDate(certificate?.eventDate),
      requiredLimitCents: numberOrUndefined(certificate?.requiredLimitCents),
      issuedAt: cleanDate(certificate?.issuedAt),
      expiresAt: cleanDate(certificate?.expiresAt),
      status: cleanText(certificate?.status),
      sourceExternalIds: unique(arrayOf(certificate?.sourceExternalIds)),
      citationId: cleanText(certificate?.citationId),
      notes: cleanText(certificate?.notes),
    }))
    .filter((certificate): certificate is any => Boolean(certificate?.holderName));
}

function normalizeInsuranceRequirements(value: unknown) {
  return arrayOf(value)
    .map((requirement: any) => compactRecord({
      context: cleanText(requirement?.context),
      requirementType: cleanText(requirement?.requirementType),
      coverageSource: cleanText(requirement?.coverageSource),
      cglLimitRequiredCents: numberOrUndefined(requirement?.cglLimitRequiredCents),
      cglLimitConfirmedCents: numberOrUndefined(requirement?.cglLimitConfirmedCents),
      additionalInsuredRequired: optionalBoolean(requirement?.additionalInsuredRequired),
      additionalInsuredLegalName: cleanText(requirement?.additionalInsuredLegalName),
      coiStatus: cleanText(requirement?.coiStatus),
      coiDueDate: cleanDate(requirement?.coiDueDate),
      tenantLegalLiabilityLimitCents: numberOrUndefined(requirement?.tenantLegalLiabilityLimitCents),
      hostLiquorLiability: cleanText(requirement?.hostLiquorLiability),
      indemnityRequired: optionalBoolean(requirement?.indemnityRequired),
      waiverRequired: optionalBoolean(requirement?.waiverRequired),
      vendorCoiRequired: optionalBoolean(requirement?.vendorCoiRequired),
      studentEventChecklistRequired: optionalBoolean(requirement?.studentEventChecklistRequired),
      riskTriggers: unique(arrayOf(requirement?.riskTriggers)),
      sourceExternalIds: unique(arrayOf(requirement?.sourceExternalIds)),
      citationId: cleanText(requirement?.citationId),
      notes: cleanText(requirement?.notes),
    }))
    .filter((requirement): requirement is any => Boolean(requirement?.context));
}

function normalizeClaimsMadeTerms(value: unknown) {
  const terms = value && typeof value === "object" ? value as any : undefined;
  if (!terms) return undefined;
  return compactRecord({
    retroactiveDate: cleanDate(terms.retroactiveDate),
    continuityDate: cleanDate(terms.continuityDate),
    reportingDeadline: cleanDate(terms.reportingDeadline),
    extendedReportingPeriod: cleanText(terms.extendedReportingPeriod),
    defenseCostsInsideLimit: optionalBoolean(terms.defenseCostsInsideLimit),
    territory: cleanText(terms.territory),
    retentionCents: numberOrUndefined(terms.retentionCents),
    claimsNoticeContact: cleanText(terms.claimsNoticeContact),
    sourceExternalIds: unique(arrayOf(terms.sourceExternalIds)),
    citationId: cleanText(terms.citationId),
    notes: cleanText(terms.notes),
  });
}

function normalizeClaimIncidents(value: unknown) {
  return arrayOf(value)
    .map((incident: any) => compactRecord({
      incidentDate: cleanDate(incident?.incidentDate),
      claimNoticeDate: cleanDate(incident?.claimNoticeDate),
      status: cleanText(incident?.status),
      privacyFlag: optionalBoolean(incident?.privacyFlag),
      insurerNotifiedAt: cleanDateTime(incident?.insurerNotifiedAt),
      brokerNotifiedAt: cleanDateTime(incident?.brokerNotifiedAt),
      sourceExternalIds: unique(arrayOf(incident?.sourceExternalIds)),
      citationId: cleanText(incident?.citationId),
      notes: cleanText(incident?.notes),
    }))
    .filter((incident): incident is any => Boolean(incident?.incidentDate || incident?.claimNoticeDate || incident?.notes));
}

function normalizeAnnualReviews(value: unknown) {
  return arrayOf(value)
    .map((review: any) => compactRecord({
      reviewDate: cleanDate(review?.reviewDate),
      boardMeetingDate: cleanDate(review?.boardMeetingDate),
      reviewer: cleanText(review?.reviewer),
      outcome: cleanText(review?.outcome),
      nextReviewDate: cleanDate(review?.nextReviewDate),
      sourceExternalIds: unique(arrayOf(review?.sourceExternalIds)),
      citationId: cleanText(review?.citationId),
      notes: cleanText(review?.notes),
    }))
    .filter((review): review is any => Boolean(review?.reviewDate));
}

function normalizeComplianceChecks(value: unknown) {
  return arrayOf(value)
    .map((check: any) => compactRecord({
      label: cleanText(check?.label),
      status: cleanText(check?.status),
      dueDate: cleanDate(check?.dueDate),
      completedAt: cleanDate(check?.completedAt),
      sourceExternalIds: unique(arrayOf(check?.sourceExternalIds)),
      citationId: cleanText(check?.citationId),
      notes: cleanText(check?.notes),
    }))
    .filter((check): check is any => Boolean(check?.label));
}

export {
  normalizePayload,
  normalizeSourcePayload,
  normalizeMotionPayload,
  normalizeMeetingMinutesPayload,
  structuredMinutesPatchFromPayload,
  normalizeRemoteParticipationPayload,
  normalizeDetailedAttendancePayload,
  normalizeMinuteSectionsPayload,
  normalizeActionItemsPayload,
  normalizeMinutesActionItem,
  normalizeSessionSegmentsPayload,
  normalizeAppendicesPayload,
  normalizeAgmDetailsPayload,
  normalizeDirectorAppointmentsPayload,
  normalizeSpecialResolutionExhibitsPayload,
  normalizeBudgetPayload,
  normalizeSectionPayload,
  dedupeInsurancePolicies,
  isImportableInsurancePolicy,
  insurancePolicyDedupeKey,
  insurancePolicySeriesKey,
  insurancePolicyTermLabel,
  mergeInsurancePolicies,
  mergeRecordArrays,
  normalizeCoveredParties,
  normalizeCoverageItems,
  normalizeCoveredLocations,
  normalizePolicyDefinitions,
  normalizeDeclinedCoverages,
  normalizeCertificatesOfInsurance,
  normalizeInsuranceRequirements,
  normalizeClaimsMadeTerms,
  normalizeClaimIncidents,
  normalizeAnnualReviews,
  normalizeComplianceChecks,
};
