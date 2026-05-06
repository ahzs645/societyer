import { useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useQuery } from "convex/react";
import { Download, ExternalLink, FileText, RefreshCw } from "lucide-react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useToast } from "../../../components/Toast";
import { Badge, Field } from "../../../components/ui";
import { Checkbox } from "../../../components/Controls";
import { formatDate } from "../../../lib/format";
import { type StructuredMinutesEdit } from "../lib/structuredMinutes";
import { materialEffectiveStatus } from "../lib/meetingMaterialAccess";

export function AttendanceDetails({
  present,
  absent,
  people,
}: {
  present: string[];
  absent: string[];
  people: PersonLinkCandidate[];
}) {
  const rows = [
    ...present.map((name) => ({ status: "Present", ...parseAttendanceName(name) })),
    ...absent.map((name) => ({ status: "Absent / Regrets", ...parseAttendanceName(name) })),
  ];

  if (rows.length === 0) {
    return (
      <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
        No attendance names recorded yet.
      </div>
    );
  }

  return (
    <details className="attendance-details">
      <summary>
        <span>Attendance list</span>
        <span className="muted">
          {present.length} present · {absent.length} Absent/Regrets
        </span>
      </summary>
      <div className="attendance-table-wrap">
        <table className="attendance-table">
          <thead>
            <tr>
              <th scope="col">Status</th>
              <th scope="col">Name</th>
              <th scope="col">Role</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.status}-${row.name}-${index}`}>
                <td>{row.status}</td>
                <td><LinkedPersonName name={row.name} people={people} /></td>
                <td>{row.role || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function StructuredMinutesSummary({ minutes }: { minutes: any }) {
  const chips = [
    minutes.chairName && `Chair: ${minutes.chairName}`,
    minutes.secretaryName && `Secretary: ${minutes.secretaryName}`,
    minutes.recorderName && `Recorder: ${minutes.recorderName}`,
    minutes.calledToOrderAt && `Called: ${minutes.calledToOrderAt}`,
    minutes.adjournedAt && `Adjourned: ${minutes.adjournedAt}`,
    minutes.remoteParticipation?.url && "Remote link",
    minutes.remoteParticipation?.meetingId && `Meeting ID: ${minutes.remoteParticipation.meetingId}`,
    (minutes.detailedAttendance ?? []).length ? `${minutes.detailedAttendance.length} detailed attendance rows` : "",
    (minutes.sections ?? []).length ? `${minutes.sections.length} minute sections` : "",
    (minutes.sessionSegments ?? []).length ? `${minutes.sessionSegments.length} session segments` : "",
    (minutes.appendices ?? []).length ? `${minutes.appendices.length} appendices` : "",
    minutes.nextMeetingAt && `Next: ${minutes.nextMeetingAt}`,
    minutes.agmDetails?.financialStatementsPresented && "Financials presented",
    (minutes.agmDetails?.directorAppointments ?? []).length ? `${minutes.agmDetails.directorAppointments.length} director appointments` : "",
  ].filter(Boolean);

  if (!chips.length) {
    return (
      <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
        No optional structured details recorded yet. Add these to generate richer minutes styles and omit blank sections automatically.
      </div>
    );
  }

  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      {chips.map((chip) => <Badge key={String(chip)} tone="neutral">{chip}</Badge>)}
    </div>
  );
}

export function StructuredMinutesEditor({
  value,
  onChange,
  isAgm,
}: {
  value: StructuredMinutesEdit;
  onChange: (value: StructuredMinutesEdit) => void;
  isAgm: boolean;
}) {
  const patch = (diff: Partial<StructuredMinutesEdit>) => onChange({ ...value, ...diff });
  return (
    <div className="structured-minutes-editor">
      <div className="structured-minutes-editor__grid">
        <Field label="Chair">
          <input className="input" value={value.chairName} onChange={(event) => patch({ chairName: event.target.value })} />
        </Field>
        <Field label="Secretary">
          <input className="input" value={value.secretaryName} onChange={(event) => patch({ secretaryName: event.target.value })} />
        </Field>
        <Field label="Recorder / minute-taker">
          <input className="input" value={value.recorderName} onChange={(event) => patch({ recorderName: event.target.value })} />
        </Field>
        <Field label="Called to order" hint="ISO date/time or source text such as 5:32 pm.">
          <input className="input" value={value.calledToOrderAt} onChange={(event) => patch({ calledToOrderAt: event.target.value })} />
        </Field>
        <Field label="Adjourned" hint="ISO date/time or source text.">
          <input className="input" value={value.adjournedAt} onChange={(event) => patch({ adjournedAt: event.target.value })} />
        </Field>
        <Field label="Next meeting">
          <input className="input" value={value.nextMeetingAt} onChange={(event) => patch({ nextMeetingAt: event.target.value })} />
        </Field>
      </div>

      <div className="structured-minutes-editor__grid">
        <Field label="Remote URL">
          <input className="input" value={value.remoteUrl} onChange={(event) => patch({ remoteUrl: event.target.value })} />
        </Field>
        <Field label="Remote meeting ID">
          <input className="input" value={value.remoteMeetingId} onChange={(event) => patch({ remoteMeetingId: event.target.value })} />
        </Field>
        <Field label="Remote passcode">
          <input className="input" value={value.remotePasscode} onChange={(event) => patch({ remotePasscode: event.target.value })} />
        </Field>
      </div>

      <Field label="Remote instructions">
        <textarea className="textarea" rows={2} value={value.remoteInstructions} onChange={(event) => patch({ remoteInstructions: event.target.value })} />
      </Field>

      <Field label="Detailed attendance" hint="One row per person: status | name | role | affiliation | member ID | proxy for | quorum yes/no | notes">
        <textarea className="textarea" rows={5} value={value.detailedAttendance} onChange={(event) => patch({ detailedAttendance: event.target.value })} />
      </Field>

      <Field label="Agenda record / per-topic notes" hint="One row per section: type | title | presenter | discussion | report yes/no | decisions ; separated | action items ; separated">
        <textarea className="textarea" rows={10} value={value.sections} onChange={(event) => patch({ sections: event.target.value })} />
      </Field>

      <Field label="Session segments" hint="One row per segment: type | title | started | ended | notes">
        <textarea className="textarea" rows={3} value={value.sessionSegments} onChange={(event) => patch({ sessionSegments: event.target.value })} />
      </Field>

      <Field label="Appendices / attachments" hint="One row: title | type | reference | notes">
        <textarea className="textarea" rows={3} value={value.appendices} onChange={(event) => patch({ appendices: event.target.value })} />
      </Field>

      <div className="structured-minutes-editor__grid">
        <Field label="Next meeting location">
          <input className="input" value={value.nextMeetingLocation} onChange={(event) => patch({ nextMeetingLocation: event.target.value })} />
        </Field>
        <Field label="Next meeting notes">
          <input className="input" value={value.nextMeetingNotes} onChange={(event) => patch({ nextMeetingNotes: event.target.value })} />
        </Field>
      </div>

      {isAgm && (
        <>
          <Checkbox
            checked={value.financialStatementsPresented}
            onChange={(financialStatementsPresented) => patch({ financialStatementsPresented })}
            label="Financial statements were presented"
          />
          <Field label="Financial statement notes">
            <textarea className="textarea" rows={3} value={value.financialStatementsNotes} onChange={(event) => patch({ financialStatementsNotes: event.target.value })} />
          </Field>
          <Field label="Director election / appointment notes">
            <textarea className="textarea" rows={3} value={value.directorElectionNotes} onChange={(event) => patch({ directorElectionNotes: event.target.value })} />
          </Field>
          <Field label="Director appointments" hint="One row: status | name | role | affiliation | term | consent yes/no | votes | elected yes/no | notes">
            <textarea className="textarea" rows={4} value={value.directorAppointments} onChange={(event) => patch({ directorAppointments: event.target.value })} />
          </Field>
          <Field label="Special-resolution exhibits" hint="One row: title | reference | notes">
            <textarea className="textarea" rows={3} value={value.specialResolutionExhibits} onChange={(event) => patch({ specialResolutionExhibits: event.target.value })} />
          </Field>
        </>
      )}
    </div>
  );
}

export type PersonLinkCandidate = {
  id: string;
  name: string;
  aliases: string[];
  kind: "member" | "director";
};

export function personLinkCandidates(members: any[] | undefined, directors: any[] | undefined): PersonLinkCandidate[] {
  return [
    ...(members ?? []).map((member: any) => ({
      id: String(member._id),
      name: `${member.firstName} ${member.lastName}`.trim(),
      aliases: Array.isArray(member.aliases) ? member.aliases : [],
      kind: "member" as const,
    })),
    ...(directors ?? []).map((director: any) => ({
      id: String(director._id),
      name: `${director.firstName} ${director.lastName}`.trim(),
      aliases: Array.isArray(director.aliases) ? director.aliases : [],
      kind: "director" as const,
    })),
  ];
}

function LinkedPersonName({ name, people }: { name: string; people: PersonLinkCandidate[] }) {
  const key = normalizePersonName(name);
  const match = people.find((person) =>
    [person.name, ...person.aliases].some((candidate) => normalizePersonName(candidate) === key),
  );
  if (!match) return <span>{name}</span>;
  return (
    <span className="row" style={{ gap: 4, flexWrap: "wrap" }}>
      <Link to={match.kind === "director" ? "/app/directors" : "/app/members"}>{name}</Link>
      <Badge tone="success">Linked</Badge>
    </span>
  );
}

function normalizePersonName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function parseAttendanceName(value: string) {
  const [name, ...roleParts] = value.split(/\s+-\s+/);
  return {
    name: name.trim() || value,
    role: roleParts.join(" - ").trim(),
  };
}

export function SourceDocumentRow({
  document,
  societyId,
}: {
  document: any;
  societyId: Id<"societies">;
}) {
  const metadata = parseDocumentMetadata(document.content);
  const externalId = sourceExternalIdFromDocument(document, metadata);
  const sourceLabel = sourceLabelForExternalId(externalId);
  const downloadUrl = useQuery(
    api.files.getUrl,
    document.storageId ? { storageId: document.storageId } : "skip",
  );
  const pullSourceDocument = useAction(api.paperless.pullSourceDocument);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const canPull = !!externalId?.match(/^paperless:\d+$/i);
  const hasActions = !!downloadUrl || (!!document.url && !downloadUrl) || canPull;

  const pull = async () => {
    if (!canPull) return;
    setBusy(true);
    try {
      const result = await pullSourceDocument({
        societyId,
        documentId: document._id,
        externalId,
      });
      toast.success(`Pulled ${result.fileName} from Paperless-ngx`);
    } catch (error: any) {
      toast.error(error?.message ?? "Could not pull the Paperless source document");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="source-document">
      <FileText className="source-document__icon" size={14} />
      <div className="source-document__main">
        <div className="source-document__title">{document.title}</div>
        <div className="source-document__meta">
          {sourceLabel ? (
            <Badge tone={externalId?.startsWith("paperless:") ? "info" : "neutral"}>{sourceLabel}</Badge>
          ) : document.category ? (
            <Badge tone="neutral">{document.category}</Badge>
          ) : null}
          {document.storageId ? (
            <Badge tone="success">Local copy</Badge>
          ) : canPull ? (
            <Badge tone="warn">No local copy</Badge>
          ) : null}
        </div>
      </div>
      {hasActions && (
        <div className="source-document__actions">
          {downloadUrl && (
            <a className="btn btn--ghost btn--sm" href={downloadUrl} target="_blank" rel="noreferrer">
              <Download size={12} /> Open
            </a>
          )}
          {document.url && !downloadUrl ? (
            <a className="btn btn--ghost btn--sm" href={document.url} target="_blank" rel="noreferrer">
              <ExternalLink size={12} /> Open
            </a>
          ) : null}
          {canPull && (
            <button className="btn btn--ghost btn--sm" disabled={busy} onClick={pull}>
              {busy ? <RefreshCw size={12} /> : <Download size={12} />}
              {busy ? "Pulling" : document.storageId ? "Refresh" : "Pull"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function parseAgenda(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return parseLines(value);
  }
}

export function parseLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function inferredPackageReviewStatus(materials: any[], sourceReviewStatus: string) {
  if (getPackageReviewBlockers(materials, sourceReviewStatus).length > 0) return "needs_review";
  return materials.length > 0 ? "ready" : "draft";
}

export function getPackageReviewBlockers(materials: any[], sourceReviewStatus: string) {
  const blockers: string[] = [];
  if (sourceReviewStatus === "imported_needs_review") {
    blockers.push("Imported meeting or minutes data still needs source review.");
  }
  if (sourceReviewStatus === "rejected") {
    blockers.push("Imported source data was rejected.");
  }
  const requiredNotReady = materials.filter((material) => material.requiredForMeeting && materialNeedsAttention(material));
  if (requiredNotReady.length > 0) {
    blockers.push(`${requiredNotReady.length} required material${requiredNotReady.length === 1 ? "" : "s"} not available.`);
  }
  const documentReview = materials.filter((material) =>
    material.requiredForMeeting &&
    ["in_review", "needs_signature", "blocked"].includes(material.document?.reviewStatus ?? ""),
  );
  if (documentReview.length > 0) {
    blockers.push(`${documentReview.length} required document${documentReview.length === 1 ? "" : "s"} still in document review.`);
  }
  return blockers;
}

function materialNeedsAttention(material: any) {
  const status = materialEffectiveStatus(material);
  return status === "pending" || status === "expired" || status === "withdrawn";
}

export function sourceReviewLabel(status: string) {
  if (status === "imported_needs_review") return "Source review";
  if (status === "source_reviewed") return "Source reviewed";
  if (status === "rejected") return "Source rejected";
  return "Manual source";
}

export function sourceReviewTone(status: string) {
  if (status === "source_reviewed") return "success" as const;
  if (status === "rejected") return "danger" as const;
  if (status === "imported_needs_review") return "warn" as const;
  return "neutral" as const;
}

export function packageReviewLabel(status: string) {
  if (status === "needs_review") return "Package review";
  if (status === "ready") return "Package ready";
  if (status === "released") return "Released";
  return "Package draft";
}

export function packageReviewTone(status: string) {
  if (status === "ready" || status === "released") return "success" as const;
  if (status === "needs_review") return "warn" as const;
  return "neutral" as const;
}

export function addRedactionName(names: string[], raw?: string | null) {
  const value = String(raw ?? "").trim();
  if (!value) return;
  const withoutParenthetical = value.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  const withoutRole = withoutParenthetical.split(/\s+-\s+/)[0]?.trim() ?? "";
  for (const candidate of [value, withoutParenthetical, withoutRole]) {
    const normalized = candidate.replace(/\s+/g, " ").trim();
    if (normalized.length >= 3) names.push(normalized);
    const firstName = normalized.match(/^([A-Z][a-zA-Z'-]{2,})\b/)?.[1];
    if (firstName) names.push(firstName);
  }
}

export function namesFromDiscussion(text: string) {
  const names = new Set<string>();
  for (const match of text.matchAll(/\b([A-Z][a-zA-Z'-]{2,}\s+[A-Z][a-zA-Z'-]{2,})\b/g)) {
    const value = match[1];
    if (!isLikelyNonPersonPhrase(value)) {
      names.add(value);
    }
  }
  for (const match of text.matchAll(/\bnaming\s+([^.;]+)/gi)) {
    match[1]
      .split(/,|\band\b/i)
      .map((name) => name.trim())
      .filter((name) => /^[A-Z][a-zA-Z'-]{2,}$/.test(name))
      .forEach((name) => names.add(name));
  }
  return Array.from(names);
}

function isLikelyNonPersonPhrase(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (/^[A-Z]{2,}\s+[A-Z]{2,}$/.test(normalized)) return true;
  return /\b(Source PDF|Editor Chief|Bank payment|Online payment|Blackboard link)\b/i.test(normalized);
}

export function sourceExternalIdsForMinutes(minutes: any) {
  if (!minutes) return [];
  if (Array.isArray(minutes.sourceExternalIds)) return minutes.sourceExternalIds.map(String);
  const parsed = parseDocumentMetadata(minutes.draftTranscript);
  return Array.isArray(parsed.sourceExternalIds) ? parsed.sourceExternalIds.map(String) : [];
}

export function parseDocumentMetadata(value: unknown): Record<string, any> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function isImportTranscriptMetadata(metadata: Record<string, any>) {
  return (
    typeof metadata.importSessionId === "string" ||
    Array.isArray(metadata.sourceExternalIds) ||
    /not an audio transcript/i.test(String(metadata.note ?? ""))
  );
}

export function importTranscriptNote(metadata: Record<string, any>) {
  const note = typeof metadata.note === "string" ? metadata.note.trim() : "";
  return note || "Imported from source documents; no audio transcript is attached.";
}

export function sourceExternalIdFromDocument(document: any, metadata = parseDocumentMetadata(document.content)) {
  const externalId = typeof metadata.externalId === "string" ? metadata.externalId : "";
  if (externalId) return externalId;
  return document.tags?.find?.((tag: string) => tag.startsWith("paperless:"));
}

export function sourceLabelForExternalId(externalId: string | undefined) {
  const paperlessId = externalId?.match(/^paperless:(\d+)$/i)?.[1];
  if (paperlessId) return `Paperless #${paperlessId}`;
  return externalId ?? "";
}

export function formatSourceReferences(value: string) {
  return value.replace(/\bpaperless:(\d+)\b/gi, "Paperless #$1");
}

export function getMeetingJoinDetails(meeting: any, minutes: any) {
  const url =
    meeting.remoteUrl ??
    minutes?.remoteParticipation?.url ??
    (isUrl(meeting.location) ? meeting.location : "");
  return {
    url,
    meetingId: meeting.remoteMeetingId ?? minutes?.remoteParticipation?.meetingId ?? "",
    passcode: meeting.remotePasscode ?? minutes?.remoteParticipation?.passcode ?? "",
    instructions: meeting.remoteInstructions ?? minutes?.remoteParticipation?.instructions ?? "",
    provider: providerForUrl(url),
  };
}

function isUrl(value: unknown) {
  return /^https?:\/\//i.test(String(value ?? "").trim());
}

function providerForUrl(value: string) {
  const lower = value.toLowerCase();
  if (!lower) return "";
  if (lower.includes("zoom.")) return "Zoom";
  if (lower.includes("teams.microsoft") || lower.includes("teams.live")) return "Teams";
  if (lower.includes("webex.")) return "Webex";
  if (lower.includes("gotomeeting.") || lower.includes("goto.com")) return "GoToMeeting";
  return "Online";
}

export function getQuorumSnapshot(minutes: any, meeting: any) {
  const required = minutes?.quorumRequired ?? meeting?.quorumRequired;
  const version = minutes?.quorumRuleVersion ?? meeting?.quorumRuleVersion;
  const effective =
    minutes?.quorumRuleEffectiveFromISO ??
    meeting?.quorumRuleEffectiveFromISO;
  const sourceLabel = minutes?.quorumSourceLabel ?? meeting?.quorumSourceLabel ?? "";
  const manualPrefix = /^Manual quorum override/i.test(sourceLabel)
    ? "Manual quorum override; "
    : "";
  const label = version
    ? `${manualPrefix}Bylaw rules v${version}${effective ? `, effective ${formatDate(effective)}` : ""}`
    : humanizeQuorumSourceLabel(sourceLabel);
  return { required, label };
}

function humanizeQuorumSourceLabel(value: string) {
  return value.replace(/effective (\d{4}-\d{2}-\d{2})/i, (_match, date) => `effective ${formatDate(date)}`);
}

export function gapStatusTone(status: "available" | "missing" | "not_collected"): "success" | "warn" | "danger" {
  if (status === "available") return "success";
  if (status === "missing") return "warn";
  return "danger";
}

export function gapStatusLabel(status: "available" | "missing" | "not_collected") {
  if (status === "available") return "Ready";
  if (status === "missing") return "Missing";
  return "Not collected";
}

export function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: "space-between" }}>
      <span className="muted">{label}</span>
      <span>{children}</span>
    </div>
  );
}

export function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className="row" style={{ padding: "4px 0" }}>
      <span style={{ color: ok ? "var(--success)" : "var(--text-tertiary)" }}>{ok ? "✓" : "○"}</span>
      <span style={{ color: ok ? "var(--text-primary)" : "var(--text-secondary)" }}>{children}</span>
    </div>
  );
}
