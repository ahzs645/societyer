export type StructuredMinutesEdit = {
  quorumStatus: "confirmed" | "not_met" | "not_recorded";
  chairName: string;
  secretaryName: string;
  recorderName: string;
  calledToOrderAt: string;
  adjournedAt: string;
  remoteUrl: string;
  remoteMeetingId: string;
  remotePasscode: string;
  remoteInstructions: string;
  detailedAttendance: string;
  sections: string;
  nextMeetingAt: string;
  nextMeetingLocation: string;
  nextMeetingNotes: string;
  sessionSegments: string;
  appendices: string;
  financialStatementsPresented: boolean;
  financialStatementsNotes: string;
  directorElectionNotes: string;
  directorAppointments: string;
  specialResolutionExhibits: string;
};

export function structuredEditFromMinutes(minutes: any): StructuredMinutesEdit {
  return {
    quorumStatus: minutes.quorumStatus ?? (minutes.quorumMet ? "confirmed" : "not_met"),
    chairName: minutes.chairName ?? "",
    secretaryName: minutes.secretaryName ?? "",
    recorderName: minutes.recorderName ?? "",
    calledToOrderAt: minutes.calledToOrderAt ?? "",
    adjournedAt: minutes.adjournedAt ?? "",
    remoteUrl: minutes.remoteParticipation?.url ?? "",
    remoteMeetingId: minutes.remoteParticipation?.meetingId ?? "",
    remotePasscode: minutes.remoteParticipation?.passcode ?? "",
    remoteInstructions: minutes.remoteParticipation?.instructions ?? "",
    detailedAttendance: serializeDetailedAttendance(minutes.detailedAttendance ?? []),
    sections: serializeSections(minutes.sections ?? []),
    nextMeetingAt: minutes.nextMeetingAt ?? "",
    nextMeetingLocation: minutes.nextMeetingLocation ?? "",
    nextMeetingNotes: minutes.nextMeetingNotes ?? "",
    sessionSegments: serializeSessionSegments(minutes.sessionSegments ?? []),
    appendices: serializeAppendices(minutes.appendices ?? []),
    financialStatementsPresented: !!minutes.agmDetails?.financialStatementsPresented,
    financialStatementsNotes: minutes.agmDetails?.financialStatementsNotes ?? "",
    directorElectionNotes: minutes.agmDetails?.directorElectionNotes ?? "",
    directorAppointments: serializeDirectorAppointments(minutes.agmDetails?.directorAppointments ?? []),
    specialResolutionExhibits: serializeSpecialResolutionExhibits(minutes.agmDetails?.specialResolutionExhibits ?? []),
  };
}

export function structuredPatchFromEdit(edit: StructuredMinutesEdit) {
  const remoteParticipation = compactObject({
    url: cleanOptional(edit.remoteUrl),
    meetingId: cleanOptional(edit.remoteMeetingId),
    passcode: cleanOptional(edit.remotePasscode),
    instructions: cleanOptional(edit.remoteInstructions),
  });
  const agmDetails = compactObject({
    financialStatementsPresented: edit.financialStatementsPresented || undefined,
    financialStatementsNotes: cleanOptional(edit.financialStatementsNotes),
    directorElectionNotes: cleanOptional(edit.directorElectionNotes),
    directorAppointments: parseDirectorAppointments(edit.directorAppointments),
    specialResolutionExhibits: parseSpecialResolutionExhibits(edit.specialResolutionExhibits),
  });
  return {
    chairName: cleanOptional(edit.chairName),
    secretaryName: cleanOptional(edit.secretaryName),
    recorderName: cleanOptional(edit.recorderName),
    calledToOrderAt: cleanOptional(edit.calledToOrderAt),
    adjournedAt: cleanOptional(edit.adjournedAt),
    remoteParticipation,
    detailedAttendance: parseDetailedAttendance(edit.detailedAttendance),
    sections: parseSections(edit.sections),
    nextMeetingAt: cleanOptional(edit.nextMeetingAt),
    nextMeetingLocation: cleanOptional(edit.nextMeetingLocation),
    nextMeetingNotes: cleanOptional(edit.nextMeetingNotes),
    sessionSegments: parseSessionSegments(edit.sessionSegments),
    appendices: parseAppendices(edit.appendices),
    agmDetails,
  };
}

/** Metadata editing must never replace the section/attendance collections:
 * their dedicated editors preserve motion links, task links and action status.
 * Explicit blank values also survive Convex JSON transport when clearing data. */
export function structuredMetadataPatchFromEdit(edit: StructuredMinutesEdit) {
  const patch = structuredPatchFromEdit(edit);
  const { sections: _sections, detailedAttendance: _attendance, ...metadata } = patch;
  return {
    ...metadata,
    quorumStatus: edit.quorumStatus,
    quorumMet: edit.quorumStatus === "confirmed",
    chairName: edit.chairName.trim(),
    secretaryName: edit.secretaryName.trim(),
    recorderName: edit.recorderName.trim(),
    calledToOrderAt: edit.calledToOrderAt.trim(),
    adjournedAt: edit.adjournedAt.trim(),
    nextMeetingAt: edit.nextMeetingAt.trim(),
    nextMeetingLocation: edit.nextMeetingLocation.trim(),
    nextMeetingNotes: edit.nextMeetingNotes.trim(),
    remoteParticipation: {
      url: edit.remoteUrl.trim(),
      meetingId: edit.remoteMeetingId.trim(),
      passcode: edit.remotePasscode.trim(),
      instructions: edit.remoteInstructions.trim(),
    },
    agmDetails: {
      ...patch.agmDetails,
      financialStatementsPresented: edit.financialStatementsPresented,
      financialStatementsNotes: edit.financialStatementsNotes.trim(),
      directorElectionNotes: edit.directorElectionNotes.trim(),
      directorAppointments: parseDirectorAppointments(edit.directorAppointments),
      specialResolutionExhibits: parseSpecialResolutionExhibits(edit.specialResolutionExhibits),
    },
  };
}

export function structuredMetadataChanges(edit: StructuredMinutesEdit, original: StructuredMinutesEdit) {
  const rowFields = [
    ["sessionSegments", "Session segments", 5, 0],
    ["appendices", "Appendices", 4, 0],
    ["directorAppointments", "Director appointments", 9, 1],
    ["specialResolutionExhibits", "Special-resolution exhibits", 3, 0],
  ] as const;
  for (const [field, label, columns, required] of rowFields) {
    if (edit[field] === original[field]) continue;
    for (const [index, row] of parsePipeRows(edit[field]).entries()) {
      if (row.length !== columns || !row[required]) {
        throw new Error(`${label}, row ${index + 1}: enter ${columns} columns separated by |, including empty columns, with a ${required === 1 ? "name" : "title or type"}. Keep each record on one line and remove extra | characters from notes.`);
      }
      if (field === "directorAppointments") {
        for (const booleanIndex of [5, 7]) {
          if (row[booleanIndex] && parseOptionalBoolean(row[booleanIndex]) === undefined) throw new Error(`${label}, row ${index + 1}: consent and elected values must be yes, no or blank.`);
        }
        if (row[6] && (!Number.isInteger(Number(row[6])) || Number(row[6]) < 0)) throw new Error(`${label}, row ${index + 1}: votes must be a non-negative whole number or blank.`);
      }
    }
  }
  const next = structuredMetadataPatchFromEdit(edit);
  const before = structuredMetadataPatchFromEdit(original);
  return Object.fromEntries(Object.entries(next).filter(([field, value]) =>
    JSON.stringify(value) !== JSON.stringify(before[field as keyof typeof before]),
  ));
}

function cleanOptional(value: string | undefined | null) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function compactObject<T extends Record<string, any>>(value: T): T | undefined {
  return Object.values(value).some((entry) => Array.isArray(entry) ? entry.length > 0 : entry !== undefined && entry !== "")
    ? value
    : undefined;
}

function parseDetailedAttendance(value: string) {
  return parsePipeRows(value).map((parts) => ({
    status: parts[0] || "present",
    name: parts[1] || parts[0] || "Unknown",
    roleTitle: cleanOptional(parts[2]),
    affiliation: cleanOptional(parts[3]),
    memberIdentifier: cleanOptional(parts[4]),
    proxyFor: cleanOptional(parts[5]),
    quorumCounted: parseOptionalBoolean(parts[6]),
    notes: cleanOptional(parts[7]),
  })).filter((row) => row.name !== "Unknown" || row.notes);
}

function serializeDetailedAttendance(rows: any[]) {
  return rows.map((row) => [
    row.status,
    row.name,
    row.roleTitle,
    row.affiliation,
    row.memberIdentifier,
    row.proxyFor,
    row.quorumCounted == null ? "" : row.quorumCounted ? "yes" : "no",
    row.notes,
  ].map((part) => part ?? "").join(" | ")).join("\n");
}

function parseSections(value: string) {
  return parsePipeRows(value).map((parts) => ({
    type: cleanOptional(parts[0]),
    title: parts[1] || parts[0] || "Section",
    presenter: cleanOptional(parts[2]),
    discussion: cleanOptional(parts[3]),
    reportSubmitted: parseOptionalBoolean(parts[4]),
    decisions: splitSemi(parts[5]),
    actionItems: splitSemi(parts[6]).map((text) => ({ text, done: false })),
  })).filter((row) => row.title !== "Section" || row.discussion);
}

function serializeSections(rows: any[]) {
  return rows.map((row) => [
    row.type,
    row.title,
    row.presenter,
    row.discussion,
    row.reportSubmitted == null ? "" : row.reportSubmitted ? "yes" : "no",
    (row.decisions ?? []).join("; "),
    (row.actionItems ?? []).map((item: any) => item.text).join("; "),
  ].map((part) => part ?? "").join(" | ")).join("\n");
}

function parseSessionSegments(value: string) {
  return parsePipeRows(value).map((parts) => ({
    type: parts[0] || "public",
    title: cleanOptional(parts[1]),
    startedAt: cleanOptional(parts[2]),
    endedAt: cleanOptional(parts[3]),
    notes: cleanOptional(parts[4]),
  })).filter((row) => row.type || row.notes);
}

function serializeSessionSegments(rows: any[]) {
  return rows.map((row) => [row.type, row.title, row.startedAt, row.endedAt, row.notes].map((part) => part ?? "").join(" | ")).join("\n");
}

function parseAppendices(value: string) {
  return parsePipeRows(value).map((parts) => ({
    title: parts[0] || "Appendix",
    type: cleanOptional(parts[1]),
    reference: cleanOptional(parts[2]),
    notes: cleanOptional(parts[3]),
  })).filter((row) => row.title !== "Appendix" || row.reference || row.notes);
}

function serializeAppendices(rows: any[]) {
  return rows.map((row) => [row.title, row.type, row.reference, row.notes].map((part) => part ?? "").join(" | ")).join("\n");
}

function parseDirectorAppointments(value: string) {
  return parsePipeRows(value).map((parts) => ({
    status: cleanOptional(parts[0]),
    name: parts[1] || parts[0] || "Unknown",
    roleTitle: cleanOptional(parts[2]),
    affiliation: cleanOptional(parts[3]),
    term: cleanOptional(parts[4]),
    consentRecorded: parseOptionalBoolean(parts[5]),
    votesReceived: numberOrUndefined(parts[6]),
    elected: parseOptionalBoolean(parts[7]),
    notes: cleanOptional(parts[8]),
  })).filter((row) => row.name !== "Unknown");
}

function serializeDirectorAppointments(rows: any[]) {
  return rows.map((row) => [
    row.status,
    row.name,
    row.roleTitle,
    row.affiliation,
    row.term,
    row.consentRecorded == null ? "" : row.consentRecorded ? "yes" : "no",
    row.votesReceived,
    row.elected == null ? "" : row.elected ? "yes" : "no",
    row.notes,
  ].map((part) => part ?? "").join(" | ")).join("\n");
}

function parseSpecialResolutionExhibits(value: string) {
  return parsePipeRows(value).map((parts) => ({
    title: parts[0] || "Exhibit",
    reference: cleanOptional(parts[1]),
    notes: cleanOptional(parts[2]),
  })).filter((row) => row.title !== "Exhibit" || row.reference || row.notes);
}

function serializeSpecialResolutionExhibits(rows: any[]) {
  return rows.map((row) => [row.title, row.reference, row.notes].map((part) => part ?? "").join(" | ")).join("\n");
}

function parsePipeRows(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("|").map((part) => part.trim()));
}

function splitSemi(value: string | undefined) {
  return String(value ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseOptionalBoolean(value: string | undefined) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return undefined;
  if (["yes", "y", "true", "1", "counted", "recorded"].includes(text)) return true;
  if (["no", "n", "false", "0", "not counted", "not recorded"].includes(text)) return false;
  return undefined;
}

function numberOrUndefined(value: string | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const number = Number(text);
  return Number.isFinite(number) ? number : undefined;
}
