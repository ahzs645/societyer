import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field, RecordChip } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { CustomFieldsPanel } from "../components/CustomFieldsPanel";
import { FilterField } from "../components/FilterBar";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { Checkbox } from "../components/Controls";
import { usePrompt } from "../components/Modal";
import { useToast } from "../components/Toast";
import { Plus, Users, Trash2, Mail, Tag, CircleUser, Vote } from "lucide-react";
import { formatDate, initials } from "../lib/format";
import { patchInList } from "../lib/optimistic";
import { useRegisterCommand } from "../lib/commands";
import { Download, Pencil, GitMerge } from "lucide-react";
import { BulkEditPanel } from "../components/BulkEditPanel";
import { MergeRecordsModal } from "../components/MergeRecordsModal";

const MEMBER_FIELDS: FilterField<any>[] = [
  { id: "name", label: "Name", icon: <CircleUser size={14} />, match: (m, q) => `${m.firstName} ${m.lastName}`.toLowerCase().includes(q.toLowerCase()) },
  { id: "email", label: "Email", icon: <Mail size={14} />, match: (m, q) => (m.email ?? "").toLowerCase().includes(q.toLowerCase()) },
  { id: "class", label: "Class", icon: <Tag size={14} />, options: ["Regular", "Honorary", "Student", "Associate"], match: (m, q) => m.membershipClass === q },
  { id: "status", label: "Status", icon: <Tag size={14} />, options: ["Active", "Inactive", "Suspended"], match: (m, q) => m.status === q },
  { id: "voting", label: "Voting rights", icon: <Vote size={14} />, options: ["Yes", "No"], match: (m, q) => (m.votingRights ? "Yes" : "No") === q },
];

export function MembersPage() {
  const society = useSociety();
  const members = useQuery(api.members.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.members.create);
  const update = useMutation(api.members.update).withOptimisticUpdate(
    (store, args) => {
      patchInList(store, api.members.list, String(args.id), args.patch);
    },
  );
  const prompt = usePrompt();
  const toast = useToast();
  const [selected, setSelected] = useState<any>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState<any[] | null>(null);
  const [mergeRows, setMergeRows] = useState<any[] | null>(null);
  const mergeMembers = useMutation(api.members.merge);

  const confirmRemove = async (r: any) => {
    const reason = await prompt({
      title: "Archive member record",
      message: `${r.firstName} ${r.lastName} will stay in the register as inactive instead of being deleted.`,
      placeholder: "Reason (required)",
      confirmLabel: "Archive member",
      required: true,
    });
    if (!reason) return;
    const prev = {
      status: r.status,
      leftAt: r.leftAt,
      votingRights: r.votingRights,
      notes: r.notes,
    };
    await update({
      id: r._id,
      patch: {
        status: "Inactive",
        leftAt: new Date().toISOString().slice(0, 10),
        votingRights: false,
        notes: [r.notes, `Archived: ${reason}`].filter(Boolean).join("\n\n"),
      },
    });
    toast.success(`Archived ${r.firstName} ${r.lastName}`, {
      description: "The member record remains available for audit and retention.",
      dedupeKey: `member-archive-${r._id}`,
      action: {
        label: "Undo",
        onClick: async () => {
          await update({ id: r._id, patch: prev });
        },
      },
    });
  };

  useRegisterCommand(
    members && members.length > 0
      ? {
          id: "members-export-csv",
          label: "Export members to CSV",
          icon: Download,
          run: () => {
            const header = "First,Last,Email,Class,Status,Joined";
            const lines = (members ?? []).map((m: any) =>
              [m.firstName, m.lastName, m.email ?? "", m.membershipClass, m.status, m.joinedAt]
                .map((v) => `"${String(v).replace(/"/g, '""')}"`)
                .join(","),
            );
            const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `members-${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          },
        }
      : null,
  );

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setSelected({
      firstName: "", lastName: "", email: "",
      membershipClass: "Regular", status: "Active", votingRights: true,
      joinedAt: new Date().toISOString().slice(0, 10),
    });
    setDrawerOpen(true);
  };

  const save = async () => {
    if (!selected) return;
    if (selected._id) {
      const { _id, _creationTime, societyId, ...patch } = selected;
      await update({ id: _id, patch });
    } else {
      await create({ societyId: society._id, ...selected });
    }
    setDrawerOpen(false);
  };

  return (
    <div className="page">
      <PageHeader
        title="Members"
        icon={<Users size={16} />}
        iconColor="blue"
        subtitle="Register of members as required under s.20 of the Societies Act."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> New member
          </button>
        }
      />

      <DataTable
        label="All members"
        icon={<Users size={14} />}
        data={(members ?? []) as any[]}
        loading={members === undefined}
        rowKey={(r) => r._id}
        filterFields={MEMBER_FIELDS}
        searchPlaceholder="Search name, email, class…"
        defaultSort={{ columnId: "name", dir: "asc" }}
        viewsKey="members"
        onRowClick={(row) => { setSelected(row); setDrawerOpen(true); }}
        columns={[
          {
            id: "name",
            header: "Name",
            sortable: true,
            accessor: (r) => `${r.firstName} ${r.lastName}`,
            render: (r) => (
              <RecordChip
                tone="blue"
                avatar={initials(r.firstName, r.lastName)}
                label={`${r.firstName} ${r.lastName}`}
              />
            ),
          },
          {
            id: "membershipClass",
            header: "Class",
            sortable: true,
            accessor: (r) => r.membershipClass,
            render: (r) => <span className="cell-tag">{r.membershipClass}</span>,
            editable: {
              type: "select",
              options: ["Regular", "Honorary", "Student", "Associate"],
              onCommit: async (row, value) => {
                await update({ id: row._id, patch: { membershipClass: value } });
              },
            },
          },
          {
            id: "status",
            header: "Status",
            sortable: true,
            accessor: (r) => r.status,
            render: (r) => <Badge tone={r.status === "Active" ? "success" : "warn"}>{r.status}</Badge>,
            editable: {
              type: "select",
              options: ["Active", "Inactive", "Suspended"],
              onCommit: async (row, value) => {
                await update({ id: row._id, patch: { status: value } });
              },
            },
          },
          {
            id: "voting",
            header: "Voting",
            sortable: true,
            accessor: (r) => (r.votingRights ? 1 : 0),
            render: (r) => r.votingRights ? <Badge tone="info">Voting</Badge> : <span className="muted">—</span>,
          },
          {
            id: "joinedAt",
            header: "Joined",
            sortable: true,
            accessor: (r) => r.joinedAt,
            render: (r) => <span className="mono">{formatDate(r.joinedAt)}</span>,
          },
          {
            id: "email",
            header: "Email",
            sortable: true,
            accessor: (r) => r.email ?? "",
            render: (r) => <span className="muted">{r.email ?? "—"}</span>,
            editable: {
              type: "text",
              placeholder: "name@example.com",
              onCommit: async (row, value) => {
                await update({ id: row._id, patch: { email: value || undefined } });
              },
            },
          },
        ]}
        renderRowActions={(r) => (
          <button
            className="btn btn--ghost btn--sm btn--icon"
            aria-label={`Remove ${r.firstName} ${r.lastName}`}
            onClick={() => confirmRemove(r)}
          >
            <Trash2 size={12} />
          </button>
        )}
        bulkActions={[
          {
            id: "bulk-edit",
            label: "Edit",
            icon: <Pencil size={12} />,
            onRun: (rows) => { setBulkRows(rows); },
            keepSelection: true,
          },
          {
            id: "bulk-merge",
            label: "Merge",
            icon: <GitMerge size={12} />,
            onRun: (rows) => {
              if (rows.length < 2) {
                toast.warn("Select at least 2 members to merge");
                return;
              }
              setMergeRows(rows);
            },
            keepSelection: true,
          },
        ]}
      />

      <MergeRecordsModal
        open={!!mergeRows && mergeRows.length >= 2}
        onClose={() => setMergeRows(null)}
        rows={(mergeRows ?? []) as any[]}
        label="members"
        fields={[
          { id: "firstName", label: "First name" },
          { id: "lastName", label: "Last name" },
          { id: "email", label: "Email" },
          { id: "phone", label: "Phone" },
          { id: "membershipClass", label: "Class" },
          { id: "status", label: "Status" },
          { id: "joinedAt", label: "Joined" },
        ]}
        onMerge={async (keepId, dropIds, merged) => {
          await mergeMembers({
            keepId: keepId as any,
            dropIds: dropIds as any,
            patch: merged,
          });
          toast.success(`Merged ${dropIds.length + 1} members`);
          setMergeRows(null);
        }}
      />

      <BulkEditPanel
        open={!!bulkRows}
        onClose={() => setBulkRows(null)}
        selectedCount={bulkRows?.length ?? 0}
        fields={[
          { id: "status", label: "Status", type: "select", options: ["Active", "Inactive", "Suspended"] },
          { id: "membershipClass", label: "Class", type: "select", options: ["Regular", "Honorary", "Student", "Associate"] },
        ]}
        onCommit={async (fieldId, value) => {
          if (!bulkRows) return;
          for (const row of bulkRows) {
            await update({ id: row._id, patch: { [fieldId]: value } });
          }
        }}
      />

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={selected?._id ? "Edit member" : "Add member"}
        footer={
          <>
            <button className="btn" onClick={() => setDrawerOpen(false)}>Cancel</button>
            <button className="btn btn--accent" onClick={save}>Save</button>
          </>
        }
      >
        {selected && (
          <div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="First name"><input className="input" value={selected.firstName} onChange={(e) => setSelected({ ...selected, firstName: e.target.value })} /></Field>
              <Field label="Last name"><input className="input" value={selected.lastName} onChange={(e) => setSelected({ ...selected, lastName: e.target.value })} /></Field>
            </div>
            <Field label="Email"><input className="input" value={selected.email ?? ""} onChange={(e) => setSelected({ ...selected, email: e.target.value })} /></Field>
            <Field label="Phone"><input className="input" value={selected.phone ?? ""} onChange={(e) => setSelected({ ...selected, phone: e.target.value })} /></Field>
            <Field label="Address"><textarea className="textarea" value={selected.address ?? ""} onChange={(e) => setSelected({ ...selected, address: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Class">
                <Select
                  value={selected.membershipClass}
                  onChange={(v) => setSelected({ ...selected, membershipClass: v })}
                  options={["Regular", "Honorary", "Student", "Associate"].map((c) => ({ value: c, label: c }))}
                />
              </Field>
              <Field label="Status">
                <Select
                  value={selected.status}
                  onChange={(v) => setSelected({ ...selected, status: v })}
                  options={["Active", "Inactive", "Suspended"].map((s) => ({ value: s, label: s }))}
                />
              </Field>
              <Field label="Joined">
                <DatePicker value={selected.joinedAt} onChange={(v) => setSelected({ ...selected, joinedAt: v })} />
              </Field>
            </div>
            <Checkbox
              checked={!!selected.votingRights}
              onChange={(v) => setSelected({ ...selected, votingRights: v })}
              label="Voting rights"
            />
            <Field label="Notes"><textarea className="textarea" value={selected.notes ?? ""} onChange={(e) => setSelected({ ...selected, notes: e.target.value })} /></Field>
            {selected._id && (
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px dashed var(--border)" }}>
                <CustomFieldsPanel
                  societyId={society._id}
                  entityType="members"
                  entityId={selected._id}
                />
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
