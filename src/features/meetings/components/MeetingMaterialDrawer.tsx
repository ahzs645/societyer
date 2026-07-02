import { useState, type Dispatch, type SetStateAction } from "react";
import { LockKeyhole } from "lucide-react";
import { Badge, Drawer, Field } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { DatePicker } from "../../../components/DatePicker";
import { MarkdownEditor } from "../../../components/MarkdownEditor";
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
  onSave: () => void | Promise<void>;
  onAddAccessGrant: () => void;
}) {
  // Guard against double-clicks: with no id, each save inserts a new material
  // row, so a slow network + double-click would attach the document twice.
  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave();
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer
      open={!!materialDraft}
      onClose={onClose}
      title={materialDraft?.id ? "Edit meeting material" : "Attach meeting material"}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : materialDraft?.id ? "Save" : "Attach"}
          </button>
        </>
      }
    >
      {materialDraft && (
        <div>
          <Field label="Document">
            <Select
              value={materialDraft.documentId}
              onChange={(value) => setMaterialDraft({ ...materialDraft, documentId: value })}
              options={[
                { value: "", label: "Choose document" },
                ...allDocuments.map((document: any) => ({ value: document._id, label: document.title })),
              ]}
            />
          </Field>
          <Field label="Agenda topic">
            <Select
              value={materialDraft.agendaLabel}
              onChange={(value) => setMaterialDraft({ ...materialDraft, agendaLabel: value })}
              options={[
                { value: "", label: "General materials" },
                ...agenda.map((item) => ({ value: item, label: item })),
              ]}
            />
          </Field>
          <Field label="Label">
            <input className="input" value={materialDraft.label} onChange={(event) => setMaterialDraft({ ...materialDraft, label: event.target.value })} placeholder="Optional display label" />
          </Field>
          <div className="row" style={{ gap: 12 }}>
            <Field label="Order">
              <input className="input" type="number" min="1" value={materialDraft.order} onChange={(event) => setMaterialDraft({ ...materialDraft, order: event.target.value })} />
            </Field>
            <Field label="Access">
              <Select value={materialDraft.accessLevel} onChange={(value) => setMaterialDraft({ ...materialDraft, accessLevel: value })}
                options={[
                  { value: "board", label: "Board" },
                  { value: "committee", label: "Committee" },
                  { value: "members", label: "Members" },
                  { value: "public", label: "Public" },
                  { value: "restricted", label: "Restricted" },
                ]} />
            </Field>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <Field label="Availability">
              <Select value={materialDraft.availabilityStatus} onChange={(value) => setMaterialDraft({ ...materialDraft, availabilityStatus: value })}
                options={AVAILABILITY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))} />
            </Field>
            <Field label="Sync / offline">
              <Select value={materialDraft.syncStatus} onChange={(value) => setMaterialDraft({ ...materialDraft, syncStatus: value })}
                options={SYNC_OPTIONS.map((option) => ({ value: option.value, label: option.label }))} />
            </Field>
          </div>
          <Field label="Expires">
            <DatePicker
              value={materialDraft.expiresAtISO}
              onChange={(value) => setMaterialDraft({ ...materialDraft, expiresAtISO: value })}
            />
          </Field>
          <div className="panel" style={{ padding: 12, borderRadius: 8 }}>
            <div className="row" style={{ justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <strong><LockKeyhole size={13} style={{ verticalAlign: -2 }} /> Specific access grants</strong>
              <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                {(materialDraft.accessGrants ?? []).length} grant{(materialDraft.accessGrants ?? []).length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <Field label="Target type">
                <Select
                  value={materialDraft.grantSubjectType}
                  onChange={(value) => setMaterialDraft({ ...materialDraft, grantSubjectType: value, grantSubjectId: "", grantSubjectLabel: "" })}
                  options={ACCESS_GRANT_TYPES.map((option) => ({ value: option.value, label: option.label }))}
                />
              </Field>
              <Field label="Permission">
                <Select value={materialDraft.grantAccess} onChange={(value) => setMaterialDraft({ ...materialDraft, grantAccess: value })}
                  options={ACCESS_GRANT_LEVELS.map((option) => ({ value: option.value, label: option.label }))} />
              </Field>
            </div>
            {materialDraft.grantSubjectType === "group" ? (
              <Field label="Group name">
                <input className="input" value={materialDraft.grantSubjectLabel} onChange={(event) => setMaterialDraft({ ...materialDraft, grantSubjectLabel: event.target.value })} placeholder="e.g. Recusal review group" />
              </Field>
            ) : (
              <Field label="Target">
                <Select value={materialDraft.grantSubjectId} onChange={(value) => setMaterialDraft({ ...materialDraft, grantSubjectId: value })}
                  options={[
                    { value: "", label: "Choose target" },
                    ...grantCandidates.map((candidate) => ({ value: candidate.id, label: candidate.label })),
                  ]} />
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
            <MarkdownEditor rows={3} value={materialDraft.notes} onChange={(markdown) => setMaterialDraft({ ...materialDraft, notes: markdown })} />
          </Field>
        </div>
      )}
    </Drawer>
  );
}
