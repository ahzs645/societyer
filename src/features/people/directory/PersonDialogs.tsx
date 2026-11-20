import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/Modal";
import { Drawer, Field } from "@/components/ui";
import { DatePicker } from "@/components/DatePicker";
import { Select } from "@/components/Select";
import { PersonPicker } from "@/components/PersonPicker";
import type { MergeCandidate } from "../PersonMergeDialog";

const ROLE_LABELS: Record<string, string> = { director: "Director", officer: "Officer", member: "Member", controller: "Significant individual" };

export type PersonForm = {
  fullName: string;
  firstName: string;
  lastName: string;
  dob: string;
  isIndividual: boolean;
  defaultAddress: string;
  gender: string;
  pronouns: string;
};

export const EMPTY_PERSON_FORM: PersonForm = {
  fullName: "",
  firstName: "",
  lastName: "",
  dob: "",
  isIndividual: true,
  defaultAddress: "",
  gender: "",
  pronouns: "",
};

/** The New person / Edit person drawer; saving upserts the directory profile. */
export function PersonDrawer({
  societyId,
  editingId,
  form,
  canManage,
  onChange,
  onClose,
}: {
  societyId: string;
  /** The profile being edited, or null for a new person. */
  editingId: string | null;
  /** The form on show; null keeps the drawer closed. */
  form: PersonForm | null;
  canManage: boolean;
  onChange: (form: PersonForm) => void;
  onClose: () => void;
}) {
  const upsert = useMutation(api.peopleDirectory.upsert);
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!canManage || saving || !form?.fullName.trim()) return;
    setSaving(true);
    try {
      await upsert({
        societyId,
        id: editingId ?? undefined,
        fullName: form.fullName.trim(),
        firstName: form.firstName || undefined,
        lastName: form.lastName || undefined,
        dob: form.dob || undefined,
        isIndividual: form.isIndividual,
        defaultAddress: form.defaultAddress || undefined,
        gender: form.gender || undefined,
        pronouns: form.pronouns || undefined,
        nowISO: new Date().toISOString(),
      });
      onClose();
    } catch (error) {
      toast.error("Person could not be saved", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={form !== null}
      onClose={onClose}
      title={editingId ? "Edit person" : "New person"}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" onClick={() => void save()} disabled={!canManage || saving || !form?.fullName.trim()}>
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      {form && <PersonFormFields form={form} onChange={onChange} />}
    </Drawer>
  );
}

/** The fields of the New person / Edit person drawer. */
function PersonFormFields({ form, onChange }: { form: PersonForm; onChange: (form: PersonForm) => void }) {
  const set = <K extends keyof PersonForm>(key: K, value: PersonForm[K]) => onChange({ ...form, [key]: value });
  return (
    <div>
      <Field label="Full name">
        <input className="input" value={form.fullName} onChange={(e) => set("fullName", e.target.value)} />
      </Field>
      <div className="row" style={{ gap: 12 }}>
        <Field label="First name">
          <input className="input" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
        </Field>
        <Field label="Last name">
          <input className="input" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
        </Field>
      </div>
      <Field label="Date of birth">
        <DatePicker value={form.dob} onChange={(value) => set("dob", value)} />
      </Field>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Default address">
          <input className="input" value={form.defaultAddress} onChange={(e) => set("defaultAddress", e.target.value)} />
        </Field>
        <Field label="Gender (for document grammar)">
          <Select
            value={form.gender}
            onChange={(value) => set("gender", value)}
            options={[
              { value: "", label: "—" },
              { value: "M", label: "Male (he/his)" },
              { value: "F", label: "Female (she/her)" },
              { value: "X", label: "Neutral (they/their)" },
            ]}
          />
        </Field>
        <Field label="Stated pronouns (override gender)">
          <input
            className="input"
            placeholder="e.g. they/them, xe/xir"
            value={form.pronouns}
            onChange={(e) => set("pronouns", e.target.value)}
          />
        </Field>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={form.isIndividual} onChange={(e) => set("isIndividual", e.target.checked)} />{" "}
        This is an individual (not an organization)
      </label>
    </div>
  );
}

/** Pick the other profile for a merge; PersonMergeDialog then asks which one to keep. */
export function ChooseMergeTarget({
  person,
  people,
  onClose,
  onChoose,
}: {
  person: { id: string; fullName: string };
  people: Array<{ _id: string; fullName: string; aliases?: string[] }>;
  onClose: () => void;
  onChoose: (other: MergeCandidate) => void;
}) {
  const [otherId, setOtherId] = useState("");
  const other = people.find((p) => p._id === otherId);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Merge ${person.fullName} with…`}
      size="sm"
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" disabled={!other} onClick={() => other && onChoose({ id: other._id, fullName: other.fullName })}>
            Continue
          </button>
        </>
      }
    >
      <p className="muted">Choose the other profile for the same person. You pick which one to keep on the next step.</p>
      <PersonPicker
        people={people.filter((p) => p._id !== person.id)}
        value={otherId}
        onChange={setOtherId}
        sourceName={person.fullName}
        ariaLabel="Profile to merge with"
      />
    </Modal>
  );
}

/** P14: adding a person to the society is a register change: confirm it, with a start date and source. */
export function AddToSocietyDialog({ societyId, person, onClose }: { societyId: string; person: { id: string; fullName: string }; onClose: () => void }) {
  const addToSociety = useMutation(api.peopleDirectory.addToSociety);
  const toast = useToast();
  const [roleType, setRoleType] = useState("director");
  const [startDate, setStartDate] = useState("");
  const [position, setPosition] = useState("Director");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [busy, setBusy] = useState(false);
  const validDate = !startDate || /^\d{4}(-\d{2}(-\d{2})?)?$/.test(startDate);
  const isDirector = roleType === "director";
  const canSubmit = !busy && validDate && (!isDirector || Boolean(startDate)) && Boolean(sourceReference.trim());

  const submit = async () => {
    setBusy(true);
    try {
      await addToSociety({
        directoryPersonId: person.id,
        societyId,
        roleType,
        ...(startDate ? { startDate } : {}),
        ...(isDirector && position.trim() ? { position: position.trim() } : {}),
        ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}),
        sourceReference: sourceReference.trim(),
        nowISO: new Date().toISOString(),
      });
      toast.success(
        `${person.fullName} added as ${ROLE_LABELS[roleType]}`,
        isDirector ? "Listed on the Directors register. Record consent and residency there." : undefined,
      );
      onClose();
    } catch (error) {
      toast.error("Could not add", error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Add ${person.fullName} to this society`}
      size="md"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn--accent" disabled={!canSubmit} onClick={() => void submit()}>
            {busy ? "Adding…" : `Add as ${ROLE_LABELS[roleType]}`}
          </button>
        </>
      }
    >
      <Field label="Role">
        <Select value={roleType} onChange={setRoleType} options={Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))} />
      </Field>
      {isDirector && (
        <p className="muted">
          This creates an <strong>Active</strong> entry on the Directors register (and a role-holder record). Consent and BC residency
          start as not recorded. For a person only seen on an old roster, use the Directors page to add them as “needs review” instead.
        </p>
      )}
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <Field label={`Start date${isDirector ? "" : " (optional)"}`} hint="YYYY, YYYY-MM or YYYY-MM-DD">
          <input className="input" aria-invalid={!validDate} value={startDate} onChange={(e) => setStartDate(e.target.value)} placeholder="2025-06-12" />
        </Field>
        {isDirector && (
          <Field label="Position">
            <input className="input" value={position} onChange={(e) => setPosition(e.target.value)} />
          </Field>
        )}
      </div>
      <Field label="Source URL (optional)">
        <input className="input" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…" />
      </Field>
      <Field label="Source (resolution, minutes or filing that establishes the role)">
        <input className="input" value={sourceReference} onChange={(e) => setSourceReference(e.target.value)} placeholder="e.g. AGM 2025 minutes, election results" />
      </Field>
    </Modal>
  );
}
