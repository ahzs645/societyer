import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field, RecordChip } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { FilterField } from "../components/FilterBar";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { Checkbox } from "../components/Controls";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { Plus, Users, Trash2, Mail, Tag, CircleUser, Vote } from "lucide-react";
import { formatDate, initials } from "../lib/format";

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
  const update = useMutation(api.members.update);
  const remove = useMutation(api.members.remove);
  const confirm = useConfirm();
  const toast = useToast();
  const [selected, setSelected] = useState<any>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const confirmRemove = async (r: any) => {
    if (!society) return;
    // Optimistic delete with undo — feels fast and gives a safety net via the
    // toast action. The snapshot lets us re-create the row if the user regrets.
    const snapshot = {
      firstName: r.firstName,
      lastName: r.lastName,
      email: r.email,
      phone: r.phone,
      address: r.address,
      membershipClass: r.membershipClass,
      status: r.status,
      joinedAt: r.joinedAt,
      votingRights: r.votingRights,
      notes: r.notes,
    };
    await remove({ id: r._id });
    const societyId = society._id;
    toast.success(`Removed ${r.firstName} ${r.lastName}`, {
      description: "They were taken off the member register.",
      action: {
        label: "Undo",
        onClick: () => {
          create({ societyId, ...snapshot });
        },
      },
    });
  };

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
        rowKey={(r) => r._id}
        filterFields={MEMBER_FIELDS}
        searchPlaceholder="Search name, email, class…"
        defaultSort={{ columnId: "name", dir: "asc" }}
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
          },
          {
            id: "status",
            header: "Status",
            sortable: true,
            accessor: (r) => r.status,
            render: (r) => <Badge tone={r.status === "Active" ? "success" : "warn"}>{r.status}</Badge>,
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
          </div>
        )}
      </Drawer>
    </div>
  );
}
