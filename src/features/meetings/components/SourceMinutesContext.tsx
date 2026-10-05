import { Badge } from "../../../components/ui";
import { formatSourceReferences } from "./MeetingDetailSupport";

export function sourceKindLabel(kind: string | undefined) {
  if (kind === "script") return "Meeting script";
  if (kind === "agenda") return "Agenda wording";
  if (kind === "template") return "Template wording";
  return "Source minutes";
}

export function sourceIsProposal(kind: string | undefined) {
  return kind === "script" || kind === "agenda" || kind === "template";
}

function readableDraftTranscript(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    // Imported drafts often contain linkage metadata rather than a transcript.
    if (typeof parsed === "string") return parsed;
    return typeof parsed?.text === "string" ? parsed.text : typeof parsed?.transcript === "string" ? parsed.transcript : "";
  } catch {
    return raw;
  }
}

/** Keep the untouched source visible beside its editable reconstruction. */
export function SourceMinutesContext({ minutes }: { minutes: any }) {
  const reconstruction = minutes?.sourceTransposition;
  if (!reconstruction) return null;
  const proposed = sourceIsProposal(reconstruction.sourceKind);
  const originalText = String(reconstruction.originalText ?? "").trim();
  const originalTranscript = readableDraftTranscript(reconstruction.originalDraftTranscript);
  const unmappedText = String(reconstruction.unmappedText ?? "").trim();
  return (
    <div className="col" style={{ gap: 8, marginBottom: 16 }} data-testid="source-minutes-context">
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Badge tone="info">{sourceKindLabel(reconstruction.sourceKind)}</Badge>
        <Badge tone="warn">Source reconstruction · awaiting review</Badge>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {proposed
          ? "The source is an agenda, script or template. Its wording is copied under agenda items for editing; proposed motions, decisions and actions do not establish what happened at a meeting."
          : "Source wording is arranged under agenda items for review. The original text is preserved below; this reconstruction does not approve or adopt the minutes."}
      </p>
      {reconstruction.sourceReference && <div className="muted">Source: {formatSourceReferences(String(reconstruction.sourceReference))}</div>}
      {unmappedText && (
        <details>
          <summary>Source text not assigned to an agenda item</summary>
          <div className="meeting-minutes-discussion" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{unmappedText}</div>
        </details>
      )}
      {(originalText || originalTranscript) && (
        <details>
          <summary>Preserved original source text</summary>
          {originalText && <div className="meeting-minutes-discussion" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{originalText}</div>}
          {originalTranscript && originalTranscript !== originalText && (
            <><strong>Original draft transcript</strong><div className="meeting-minutes-discussion" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{originalTranscript}</div></>
          )}
        </details>
      )}
    </div>
  );
}
