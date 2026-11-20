import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "convex/react";
import { GitMerge, Plus, Undo2, Users } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useToast } from "@/components/Toast";
import { Modal, useConfirm } from "@/components/Modal";
import { Badge, Drawer, Field } from "@/components/ui";
import { PersonPicker, useDirectoryPeople } from "@/components/PersonPicker";
import { FIELD_TYPES, RecordListTable, RecordTableEmpty, staticRecordTable } from "@/platform/record-engine";
import { formatDate } from "@/lib/format";
import { PersonMergeDialog } from "../PersonMergeDialog";
import { CardHead, errorMessage, type MergeRow, type ProfilePerson, type RegisterLink } from "./shared";

/** The person profile's Identity tab: confirmed aliases, linked register records and merges. */

type RegisterRecord = RegisterLink & { name: string; register: string; role: string; term: string };

const REGISTERS_TABLE = staticRecordTable({
  id: "person-profile:registers",
  nameSingular: "linkedRegisterRecord",
  namePlural: "linkedRegisterRecords",
  labelSingular: "Register record",
  labelPlural: "Register records",
  labelIdentifierFieldName: "name",
  fields: [
    { name: "name", label: "Record", fieldType: FIELD_TYPES.TEXT, size: 220, config: { groupable: false } },
    { name: "register", label: "Register", fieldType: FIELD_TYPES.TEXT, size: 160 },
    { name: "role", label: "Position or class", fieldType: FIELD_TYPES.TEXT, size: 180 },
    { name: "status", label: "Status", fieldType: FIELD_TYPES.TEXT, size: 120 },
    { name: "term", label: "Term", fieldType: FIELD_TYPES.TEXT, size: 200, config: { groupable: false } },
    { name: "notes", label: "Notes", fieldType: FIELD_TYPES.TEXT, size: 240, config: { groupable: false } },
  ],
});

type ProfileMergeRecord = MergeRow & { change: string };

const PROFILE_MERGES_TABLE = staticRecordTable({
  id: "person-profile:merges",
  nameSingular: "personMerge",
  namePlural: "personMerges",
  labelSingular: "Merge",
  labelPlural: "Merges",
  labelIdentifierFieldName: "mergedName",
  sorts: [{ field: "createdAtISO", direction: "desc" }],
  fields: [
    { name: "mergedName", label: "Merged profile", fieldType: FIELD_TYPES.TEXT, size: 220, config: { groupable: false } },
    { name: "change", label: "Change", fieldType: FIELD_TYPES.TEXT, size: 240, config: { groupable: false } },
    { name: "createdAtISO", label: "Merged", fieldType: FIELD_TYPES.DATE, size: 130 },
    { name: "movedReferences", label: "Links moved", fieldType: FIELD_TYPES.NUMBER, size: 120, config: { groupable: false } },
    {
      name: "status",
      label: "Status",
      fieldType: FIELD_TYPES.SELECT,
      size: 120,
      config: { options: [{ value: "applied", label: "Merged", color: "green" }, { value: "undone", label: "Undone", color: "gray" }] },
    },
  ],
});

/* ------------------------------ identity tab ----------------------------- */

export function AliasesCard({ societyId, personId, aliases, canWrite }: { societyId: string; personId: string; aliases: string[]; canWrite: boolean }) {
  const setAliases = useMutation(api.personHistory.setAliases);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [alias, setAlias] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [citation, setCitation] = useState("");
  const ready = Boolean(alias && sourceUrl && citation);

  const save = async () => {
    if (!ready) return;
    try {
      await setAliases({
        societyId,
        personId,
        aliases: [alias],
        source: { sourceUrl, sourceReference: citation, reviewStatus: "verified" },
      });
      setAlias("");
      toast.success("Alias evidence recorded");
      setOpen(false);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <section className="card">
      <CardHead title="Aliases">
        {canWrite && (
          <button type="button" className="btn-action" onClick={() => setOpen(true)}>
            <Plus size={12} /> Confirm alias
          </button>
        )}
      </CardHead>
      <div className="card__body">
        {aliases.length ? (
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {aliases.map((name) => <Badge key={name}>{name}</Badge>)}
          </div>
        ) : (
          <p className="muted">None confirmed. Confirm an alias with the source that shows the person under that name.</p>
        )}
      </div>
      {canWrite && (
        <Drawer
          open={open}
          onClose={() => setOpen(false)}
          title="Confirm a name alias"
          footer={
            <>
              <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn btn--accent" disabled={!ready} onClick={() => void save()}>Add reviewed alias</button>
            </>
          }
        >
          <Field label="Alias">
            <input className="input" value={alias} onChange={(e) => setAlias(e.target.value)} />
          </Field>
          <Field label="Source URL">
            <input className="input" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
          </Field>
          <Field label="Citation">
            <input className="input" value={citation} onChange={(e) => setCitation(e.target.value)} />
          </Field>
        </Drawer>
      )}
    </section>
  );
}

export function RegistersCard({ registers }: { registers: RegisterLink[] }) {
  const records = useMemo<RegisterRecord[]>(
    () => registers.map((row) => {
      const end = row.termEnd || row.leftAt;
      const start = row.termStart || row.joinedAt || "";
      return {
        ...row,
        name: [row.firstName, row.lastName].filter(Boolean).join(" "),
        register: row.recordTable === "members" ? "Member record" : "Director register",
        role: row.position || row.membershipClass || "",
        term: end ? `${start} to ${end}` : start,
      };
    }),
    [registers],
  );
  return (
    <section className="card">
      <CardHead title="Linked membership and director records" />
      <RecordListTable<RegisterRecord>
        variant="card"
        table={REGISTERS_TABLE}
        tableId="person-profile-registers"
        label="Register records"
        icon={<Users size={14} />}
        records={records}
        renderCell={({ record, field }) => {
          if (field.name === "name") return <Link to={record.href}>{record.name || record.register}</Link>;
          return undefined;
        }}
        emptyState={<RecordTableEmpty title="No linked register records" description="Member and director records linked to this profile appear here." />}
      />
    </section>
  );
}

export function MergesCard({
  societyId,
  person,
  merges,
  canWrite,
}: {
  societyId: string;
  person: ProfilePerson;
  merges: MergeRow[] | undefined;
  canWrite: boolean;
}) {
  const unmerge = useMutation(api.personHistory.unmergePeople);
  const confirm = useConfirm();
  const toast = useToast();
  const [choosing, setChoosing] = useState(false);
  const records = useMemo<ProfileMergeRecord[]>(
    () => (merges ?? []).map((row) => ({
      ...row,
      change: row.survivorId === person._id ? "Merged into this profile" : `Merged into ${row.survivorName}`,
    })),
    [merges, person._id],
  );

  const undo = async (row: MergeRow) => {
    const ok = await confirm({
      title: `Undo merge of ${row.mergedName}?`,
      message: `${row.mergedName} becomes a separate profile again and the moved links go back.`,
      confirmLabel: "Undo merge",
      tone: "warn",
    });
    if (!ok) return;
    try {
      await unmerge({ societyId, mergeId: row._id });
      toast.success("Merge undone");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <section className="card">
      <CardHead title="Merges" subtitle="Each merge can be undone.">
        {canWrite && (
          <button type="button" className="btn-action" onClick={() => setChoosing(true)}>
            <GitMerge size={12} /> Merge another profile…
          </button>
        )}
      </CardHead>
      <RecordListTable<ProfileMergeRecord>
        variant="card"
        table={PROFILE_MERGES_TABLE}
        tableId="person-profile-merges"
        label="Merges"
        icon={<GitMerge size={14} />}
        records={records}
        loading={merges === undefined}
        renderCell={({ record, field }) => {
          if (field.name === "createdAtISO") return <span>{formatDate(record.createdAtISO)}</span>;
          if (field.name === "status") return record.status === "undone" ? <Badge>Undone</Badge> : <Badge tone="success">Merged</Badge>;
          return undefined;
        }}
        renderRowActions={(row) =>
          canWrite && row.status !== "undone" ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void undo(row)}>
              <Undo2 size={12} /> Undo
            </button>
          ) : null
        }
        emptyState={
          <RecordTableEmpty
            title="No merges"
            description="Merging another profile for the same person moves its history, attendance, motions, tasks and register links here and keeps its name as an alias."
          />
        }
      />
      {choosing && <MergeIntoThisDialog societyId={societyId} person={person} onClose={() => setChoosing(false)} />}
    </section>
  );
}

/** Choose another profile for the same person, then confirm the merge (which keeps one of the two). */
function MergeIntoThisDialog({ societyId, person, onClose }: { societyId: string; person: ProfilePerson; onClose: () => void }) {
  const people = useDirectoryPeople(societyId);
  const [otherId, setOtherId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const other = people?.find((candidate) => candidate._id === otherId);

  if (confirming && other) {
    return (
      <PersonMergeDialog
        societyId={societyId}
        people={[{ id: person._id, fullName: person.fullName }, { id: other._id, fullName: other.fullName }]}
        onClose={onClose}
      />
    );
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={`Merge with ${person.fullName}`}
      size="sm"
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" disabled={!other} onClick={() => setConfirming(true)}>Continue</button>
        </>
      }
    >
      <p className="muted">Choose the other profile for the same person. You pick which one to keep on the next step.</p>
      <PersonPicker
        people={people?.filter((candidate) => candidate._id !== person._id)}
        value={otherId}
        onChange={setOtherId}
        sourceName={person.fullName}
        placeholder="Another profile for the same person"
        ariaLabel="Profile to merge into this one"
      />
    </Modal>
  );
}
