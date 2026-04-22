import type { Dispatch, SetStateAction } from "react";
import { LockKeyhole } from "lucide-react";
import { Badge, Drawer, Field } from "../../../components/ui";
import { Checkbox } from "../../../components/Controls";
import {
  ACCESS_GRANT_LEVELS,
  ACCESS_GRANT_TYPES,
  AVAILABILITY_OPTIONS,
  SYNC_OPTIONS,
  accessGrantLabel,
  grantKey,
  grantTypeLabel,
} from "../lib/meetingMaterialAccess";

type GrantCandidate = {
  id: string;
  label: string;
};

export function MeetingMaterialDrawer({
  materialDraft,
  setMaterialDraft,
  allDocuments,
  agenda,
  grantCandidates,
  onClose,
  onSave,
  onAddAccessGrant,
}: {
  materialDraft: any | null;
  setMaterialDraft: Dispatch<SetStateAction<any | null>>;
  allDocuments: any[];
  agenda: string[];
  grantCandidates: GrantCandidate[];
  onClose: () => void;
  onSave: () => void;
  onAddAccessGrant: () => void;
}) {
  return (
    <Drawer
      open={!!materialDraft}
      onClose={onClose}
      title={materialDraft?.id ? "Edit meeting material" : "Attach meeting material"}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" onClick={onSave}>{materialDraft?.id ? "Save" : "Attach"}</button>
        </>
      }
    >
      {materialDraft && (
        <div>
          <Field label="Document">
            <select
              className="input"
              value={materialDraft.documentId}
              onChange={(event) => setMaterialDraft({ ...materialDraft, documentId: event.target.value })}
            >
              <option value="">Choose document</option>
              {allDocuments.map((document: any) => (
                <option key={document._id} value={document._id}>{document.title}</option>
              ))}
            </select>
          </Field>
          <Field label="Agenda topic">
            <select
              className="input"
              value={materialDraft.agendaLabel}
              onChange={(event) => setMaterialDraft({ ...materialDraft, agendaLabel: event.target.value })}
            >
              <option value="">General materials</option>
              {agenda.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </Field>
          <Field label="Label">
            <input className="input" value={materialDraft.label} onChange={(event) => setMaterialDraft({ ...materialDraft, label: event.target.value })} placeholder="Optional display label" />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Order">
              <input className="input" type="number" min="1" value={materialDraft.order} onChange={(event) => setMaterialDraft({ ...materialDraft, order: event.target.value })} />
            </Field>
            <Field label="Access">
              <select className="input" value={materialDraft.accessLevel} onChange={(event) => setMaterialDraft({ ...materialDraft, accessLevel: event.target.value })}>
                <option value="board">Board</option>
                <option value="committee">Committee</option>
                <option value="members">Members</option>
                <option value="public">Public</option>
                <option value="restricted">Restricted</option>
              </select>
            </Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Availability">
              <select className="input" value={materialDraft.availabilityStatus} onChange={(event) => setMaterialDraft({ ...materialDraft, availabilityStatus: event.target.value })}>
                {AVAILABILITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </Field>
            <Field label="Sync / offline">
              <select className="input" value={materialDraft.syncStatus} onChange={(event) => setMaterialDraft({ ...materialDraft, syncStatus: event.target.value })}>
                {SYNC_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Expires">
            <input
              className="input"
              type="date"
              value={materialDraft.expiresAtISO}
              onChange={(event) => setMaterialDraft({ ...materialDraft, expiresAtISO: event.target.value })}
            />
          </Field>
          <div className="panel" style={{ padding: 12, borderRadius: 8 }}>
            <div className="row" style={{ justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <strong><LockKeyhole size={13} style={{ verticalAlign: -2 }} /> Specific access grants</strong>
              <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                {(materialDraft.accessGrants ?? []).length} grant{(materialDraft.accessGrants ?? []).length === 1 ? "" : "s"}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Field label="Target type">
                <select
                  className="input"
                  value={materialDraft.grantSubjectType}
                  onChange={(event) => setMaterialDraft({ ...materialDraft, grantSubjectType: event.target.value, grantSubjectId: "", grantSubjectLabel: "" })}
                >
                  {ACCESS_GRANT_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </Field>
              <Field label="Permission">
                <select className="input" value={materialDraft.grantAccess} onChange={(event) => setMaterialDraft({ ...materialDraft, grantAccess: event.target.value })}>
                  {ACCESS_GRANT_LEVELS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </Field>
            </div>
            {materialDraft.grantSubjectType === "group" ? (
              <Field label="Group name">
                <input className="input" value={materialDraft.grantSubjectLabel} onChange={(event) => setMaterialDraft({ ...materialDraft, grantSubjectLabel: event.target.value })} placeholder="e.g. Recusal review group" />
              </Field>
            ) : (
              <Field label="Target">
                <select className="input" value={materialDraft.grantSubjectId} onChange={(event) => setMaterialDraft({ ...materialDraft, grantSubjectId: event.target.value })}>
                  <option value="">Choose target</option>
                  {grantCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
                </select>
              </Field>
            )}
            <button className="btn btn--ghost btn--sm" type="button" onClick={onAddAccessGrant}>
              Add grant
            </button>
            <div className="col" style={{ gap: 6, marginTop: 10 }}>
              {(materialDraft.accessGrants ?? []).map((grant: any) => (
                <div key={grantKey(grant)} className="row" style={{ gap: 8, justifyContent: "space-between" }}>
                  <span>
                    <Badge tone="info">{grantTypeLabel(grant.subjectType)}</Badge>{" "}
                    {grant.subjectLabel} · {accessGrantLabel(grant.access)}
                  </span>
                  <button
                    className="btn btn--ghost btn--sm"
                    type="button"
                    onClick={() => setMaterialDraft({
                      ...materialDraft,
                      accessGrants: (materialDraft.accessGrants ?? []).filter((row: any) => grantKey(row) !== grantKey(grant)),
                    })}
                  >
                    Remove
                  </button>
                </div>
              ))}
              {(materialDraft.accessGrants ?? []).length === 0 && (
                <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                  No specific people, attendee, committee, or group grants added. The broad access level still applies.
                </div>
              )}
            </div>
          </div>
          <Checkbox
            checked={!!materialDraft.requiredForMeeting}
            onChange={(requiredForMeeting) => setMaterialDraft({ ...materialDraft, requiredForMeeting })}
            label="Required review for this meeting"
          />
          <Field label="Notes">
            <textarea className="textarea" rows={3} value={materialDraft.notes} onChange={(event) => setMaterialDraft({ ...materialDraft, notes: event.target.value })} />
          </Field>
        </div>
      )}
    </Drawer>
  );
}
