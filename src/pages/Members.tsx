import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Drawer, Field } from "../components/ui";
import { CustomFieldsPanel } from "../components/CustomFieldsPanel";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { Checkbox } from "../components/Controls";
import { usePrompt } from "../components/Modal";
import { useToast } from "../components/Toast";
import { Plus, Users, Trash2, Pencil, GitMerge, Download } from "lucide-react";
import { patchInList } from "../lib/optimistic";
import { useRegisterCommand } from "../lib/commands";
import { rowsToCsv } from "../lib/csv";
import { BulkEditPanel } from "../components/BulkEditPanel";
import { MergeRecordsModal } from "../components/MergeRecordsModal";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  RecordTableBulkBar,
  useObjectRecordTableData,
} from "@/modules/object-record";
import type { Id } from "../../convex/_generated/dataModel";

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
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);
  const mergeMembers = useMutation(api.members.merge);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "member",
    viewId: currentViewId,
  });

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
            const body = rowsToCsv([
              ["First", "Last", "Email", "Class", "Status", "Joined"],
              ...(members ?? []).map((m: any) => [
                m.firstName,
                m.lastName,
                m.email ?? "",
                m.membershipClass,
                m.status,
                m.joinedAt,
              ]),
            ]);
            const blob = new Blob([body], { type: "text/csv" });
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
      aliases: [],
      membershipClass: "Regular", status: "Active", votingRights: true,
      joinedAt: new Date().toISOString().slice(0, 10),
    });
    setDrawerOpen(true);
  };

  const save = async () => {
    if (!selected) return;
    if (selected._id) {
      const { _id, _creationTime, societyId, ...patch } = selected;
      patch.aliases = cleanAliases(patch.aliases);
      await update({ id: _id, patch });
    } else {
      await create({ societyId: society._id, ...selected, aliases: cleanAliases(selected.aliases) });
    }
    setDrawerOpen(false);
  };

  const records = (members ?? []) as any[];
  const metadataLoading = tableData.loading;
  const showMetadataWarning = !metadataLoading && !tableData.objectMetadata;

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

      {showMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="member" />
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="members"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
          onRecordClick={(_, record) => {
            setSelected(record);
            setDrawerOpen(true);
          }}
          onUpdate={async ({ recordId, fieldName, value }) => {
            await update({
              id: recordId as Id<"members">,
              patch: { [fieldName]: value } as any,
            });
          }}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<Users size={14} />}
            label="All members"
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onOpenFilter={() => setFilterOpen((x) => !x)}
          />

          <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
          <RecordTableFilterChips />

          <RecordTable
            selectable
            loading={metadataLoading || members === undefined}
          />

          <RecordTableBulkBar
            actions={[
              {
                id: "bulk-edit",
                label: "Edit",
                icon: <Pencil size={12} />,
                keepSelection: true,
                onRun: (_ids, rows) => setBulkRows(rows),
              },
              {
                id: "bulk-merge",
                label: "Merge",
                icon: <GitMerge size={12} />,
                keepSelection: true,
                onRun: (_ids, rows) => {
                  if (rows.length < 2) {
                    toast.warn("Select at least 2 members to merge");
                    return;
                  }
                  setMergeRows(rows);
                },
              },
              {
                id: "bulk-archive",
                label: "Archive",
                icon: <Trash2 size={12} />,
                tone: "danger",
                onRun: async (_ids, rows) => {
                  for (const r of rows) await confirmRemove(r);
                },
              },
            ]}
          />
        </RecordTableScope>
      ) : (
        <div className="record-table__loading">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="record-table__loading-row" />
          ))}
        </div>
      )}

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
            <Field label="Aliases">
              <input
                className="input"
                value={(selected.aliases ?? []).join(", ")}
                onChange={(e) => setSelected({ ...selected, aliases: e.target.value.split(",") })}
                placeholder="Alternate names, separated by commas"
              />
            </Field>
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

function cleanAliases(value: unknown) {
  const items = Array.isArray(value) ? value : String(value ?? "").split(",");
  return Array.from(new Set(items.map((item) => String(item).trim()).filter(Boolean)));
}
