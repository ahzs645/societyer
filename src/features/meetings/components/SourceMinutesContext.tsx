import { Link } from "react-router-dom";
import { Badge } from "../../../components/ui";

export function sourceKindLabel(kind: string | undefined) {
  if (kind === "script") return "Meeting script";
  if (kind === "agenda") return "Agenda";
  if (kind === "template") return "Meeting template";
  return "Source minutes";
}

export function sourceIsProposal(kind: string | undefined) {
  return kind === "script" || kind === "agenda" || kind === "template";
}

/** Readable source metadata; full extraction history stays in the Sources tab. */
export function SourceMinutesContext({ minutes }: { minutes: any }) {
  const record = minutes?.sourceMeetingRecord;
  const reconstruction = minutes?.sourceTransposition;
  if (!record && !reconstruction) return null;
  const header = record?.header ?? {};
  const kind = record?.sourceKind ?? reconstruction?.sourceKind;
  const participants = Array.isArray(record?.participants) ? record.participants : [];
  const participantLabel = (person: any) => [person.name, person.roleTitle, person.affiliation].filter(Boolean).join(" · ");
  const rows = [
    ["Date", header.dateText],
    ["Time", header.timeText],
    ["Place", header.locationText],
    ...([ ["Present", "present"], ["Regrets", "regrets"], ["Absent", "absent"], ["Staff", "staff"], ["Guests", "guest"] ] as const)
      .map(([label, category]) => [label, participants.filter((person: any) => person.category === category).map(participantLabel).filter(Boolean).join("; ")]),
  ].filter(([, value]) => typeof value === "string" && value.trim());
  return (
    <div className="col" style={{ gap: 8, marginBottom: 16 }} data-testid="source-minutes-context">
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Badge tone="info">{sourceKindLabel(kind)}</Badge>
        {sourceIsProposal(kind) && <span className="muted">Proposed business</span>}
        <Link className="muted" style={{ marginLeft: "auto" }} to={`/app/meetings/${minutes.meetingId}?tab=sources`}>Source</Link>
      </div>
      {header.literalTitle && <strong>{header.literalTitle}</strong>}
      {rows.length > 0 && (
        <dl style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: "4px 12px", margin: 0 }}>
          {rows.map(([label, value]) => <div key={label} style={{ display: "contents" }}><dt className="muted">{label}</dt><dd style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{value}</dd></div>)}
        </dl>
      )}
    </div>
  );
}
