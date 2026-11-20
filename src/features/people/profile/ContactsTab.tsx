import { useState } from "react";
import { useMutation } from "convex/react";
import { Plus, Users } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useToast } from "@/components/Toast";
import { Badge, Drawer, Field } from "@/components/ui";
import { Select } from "@/components/Select";
import { FIELD_TYPES, RecordListTable, RecordTableEmpty, RecordTablePhoneCard, staticRecordTable } from "@/platform/record-engine";
import {
  CONTACT_KINDS,
  CardHead,
  PARTIAL_DATE_HINT,
  REVIEW_STATUSES,
  ReviewStatusBadge,
  SourceLink,
  errorMessage,
  plainOptions,
  type ContactPoint,
} from "./shared";

/** The person profile's Contacts tab: dated contact details observed in sources. */

const CONTACTS_TABLE = staticRecordTable({
  id: "person-profile:contacts",
  nameSingular: "personContactPoint",
  namePlural: "personContactPoints",
  labelSingular: "Contact detail",
  labelPlural: "Contact details",
  labelIdentifierFieldName: "value",
  sorts: [{ field: "observedDate", direction: "desc" }],
  fields: [
    { name: "value", label: "Value", fieldType: FIELD_TYPES.TEXT, size: 240, config: { groupable: false } },
    { name: "kind", label: "Type", fieldType: FIELD_TYPES.SELECT, size: 120, config: { options: CONTACT_KINDS.map((kind) => ({ value: kind, label: kind, color: "gray" })) } },
    { name: "observedDate", label: "Observed", fieldType: FIELD_TYPES.TEXT, size: 130 },
    { name: "reviewStatus", label: "Review", fieldType: FIELD_TYPES.SELECT, size: 160, config: { options: REVIEW_STATUSES } },
    { name: "sourceReference", label: "Source", fieldType: FIELD_TYPES.TEXT, size: 220, config: { groupable: false } },
  ],
});


/* ------------------------------ contacts tab ----------------------------- */

type ContactForm = { kind: string; value: string; observedDate: string; reviewStatus: string; sourceUrl: string; sourceReference: string };
const BLANK_CONTACT: ContactForm = { kind: "email", value: "", observedDate: "", reviewStatus: "pending", sourceUrl: "", sourceReference: "" };

export function ContactsCard({
  societyId,
  personId,
  contactPoints,
  canWrite,
}: {
  societyId: string;
  personId: string;
  contactPoints: ContactPoint[];
  canWrite: boolean;
}) {
  const addContact = useMutation(api.personHistory.addContactPoint);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState<ContactForm>(BLANK_CONTACT);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof ContactForm>(key: K, value: ContactForm[K]) => setContact({ ...contact, [key]: value });
  const ready = Boolean(contact.value.trim() && contact.observedDate.trim() && contact.sourceUrl.trim() && contact.sourceReference.trim());

  const save = async () => {
    if (busy || !ready) return;
    setBusy(true);
    try {
      await addContact({ societyId, personId, point: { ...contact, pointKey: crypto.randomUUID() } });
      setContact({ ...contact, value: "" });
      toast.success("Dated contact observation saved");
      setOpen(false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <CardHead title="Contact details observed in sources" subtitle="Values keep their source periods; current contact details need confirmation.">
        {canWrite && (
          <button type="button" className="btn-action" onClick={() => setOpen(true)}>
            <Plus size={12} /> Record contact detail
          </button>
        )}
      </CardHead>
      <RecordListTable<ContactPoint>
        variant="card"
        table={CONTACTS_TABLE}
        tableId="person-profile-contacts"
        label="Contact details"
        icon={<Users size={14} />}
        records={contactPoints}
        renderCell={({ record, field }) => {
          if (field.name === "reviewStatus") {
            return (
              <span>
                <ReviewStatusBadge status={record.reviewStatus} />
                {record.testOnlyAssumption && <> <Badge tone="warn">Test identity assumption</Badge></>}
              </span>
            );
          }
          if (field.name === "sourceReference") return <SourceLink url={record.sourceUrl} reference={record.sourceReference} />;
          return undefined;
        }}
        renderPhoneCard={(row, { selecting }) => (
          <RecordTablePhoneCard
            title={row.value}
            badge={<ReviewStatusBadge status={row.reviewStatus} />}
            meta={[row.kind, row.observedDate]}
            detail={[row.sourceReference]}
            selecting={selecting}
          />
        )}
        emptyState={<RecordTableEmpty title="No contact details recorded" />}
      />
      {canWrite && (
        <Drawer
          open={open}
          onClose={() => setOpen(false)}
          title="Record a dated contact detail"
          footer={
            <>
              <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn btn--accent" disabled={busy || !ready} onClick={() => void save()}>Save contact observation</button>
            </>
          }
        >
          <Field label="Contact type">
            <Select value={contact.kind} onChange={(kind) => set("kind", kind)} options={plainOptions(CONTACT_KINDS)} />
          </Field>
          <Field label="Contact value" required>
            <input className="input" value={contact.value} onChange={(e) => set("value", e.target.value)} />
          </Field>
          <Field label="Observed source date" hint={PARTIAL_DATE_HINT} required>
            <input className="input" value={contact.observedDate} onChange={(e) => set("observedDate", e.target.value)} />
          </Field>
          <Field label="Contact source URL" required>
            <input className="input" value={contact.sourceUrl} onChange={(e) => set("sourceUrl", e.target.value)} />
          </Field>
          <Field label="Contact source citation" required>
            <input className="input" value={contact.sourceReference} onChange={(e) => set("sourceReference", e.target.value)} />
          </Field>
          <Field label="Contact review">
            <Select value={contact.reviewStatus} onChange={(reviewStatus) => set("reviewStatus", reviewStatus)} options={plainOptions(["pending", "verified"])} />
          </Field>
        </Drawer>
      )}
    </section>
  );
}

