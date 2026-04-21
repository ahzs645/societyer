import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Drawer, Field, InspectorNote } from "../components/ui";
import { Plus, UserCheck, Trash2 } from "lucide-react";
import { useBylawRules } from "../hooks/useBylawRules";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/modules/object-record";
import type { Id } from "../../convex/_generated/dataModel";

/**
 * Proxies and ballots. Each row in the record table is a proxy joined
 * with its meeting — `meetingTitle` and `status` (Active / Revoked) are
 * *projected* in on the client so the table shows human-friendly
 * columns without a Convex-side join. Revoke / delete stay as row
 * actions so the bylaw-rule warning path doesn't have to be
 * implemented twice.
 */
export function ProxiesPage() {
  const society = useSociety();
  const { rules } = useBylawRules();
  const meetings = useQuery(api.meetings.list, society ? { societyId: society._id } : "skip");
  const members = useQuery(api.members.list, society ? { societyId: society._id } : "skip");
  const proxies = useQuery(api.proxies.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.proxies.create);
  const update = useMutation(api.proxies.update);
  const revoke = useMutation(api.proxies.revoke);
  const remove = useMutation(api.proxies.remove);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "proxy",
    viewId: currentViewId,
  });

  const meetingById = useMemo(
    () => new Map<string, any>((meetings ?? []).map((m: any) => [m._id, m])),
    [meetings],
  );

  const records = useMemo(
    () =>
      (proxies ?? []).map((p: any) => ({
        ...p,
        meetingTitle: meetingById.get(p.meetingId)?.title ?? "—",
        status: p.revokedAtISO ? "Revoked" : "Active",
      })),
    [proxies, meetingById],
  );

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setForm({
      meetingId: meetings?.[0]?._id,
      grantorName: "",
      proxyHolderName: "",
      signedAtISO: new Date().toISOString().slice(0, 10),
    });
    setOpen(true);
  };
  const save = async () => {
    await create({ societyId: society._id, ...form });
    setOpen(false);
  };

  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

  return (
    <div className="page">
      <PageHeader
        title="Proxies & ballots"
        icon={<UserCheck size={16} />}
        iconColor="purple"
        subtitle={`Proxy appointments for general meetings. Active rule set: ${rules?.allowProxyVoting ? "proxies allowed" : "proxies disabled"}, ${rules?.proxyLimitPerGrantorPerMeeting ?? 1} holder(s) per grantor per meeting.`}
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew} disabled={!rules?.allowProxyVoting}>
            <Plus size={12} /> New proxy
          </button>
        }
      />

      {rules && !rules.allowProxyVoting && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__body">
            The active bylaw rule set disables proxy voting. Existing proxy records remain
            visible for history, but new appointments are blocked.
          </div>
        </div>
      )}

      {showMetadataWarning ? (
        <div className="record-table__empty">
          <div className="record-table__empty-title">Metadata not seeded</div>
          <div className="record-table__empty-desc">
            Run <code>npx convex run seedRecordTableMetadata:run</code> to create the
            proxy object metadata + default view.
          </div>
        </div>
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="proxies"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
          onUpdate={async ({ recordId, fieldName, value }) => {
            // Skip writes for the two projected fields (they're derived
            // from `meetingId` / `revokedAtISO` and not columns in the
            // real `proxies` table).
            if (fieldName === "meetingTitle" || fieldName === "status" || fieldName === "revokedAtISO") {
              return;
            }
            await update({
              id: recordId as Id<"proxies">,
              patch: { [fieldName]: value } as any,
            });
          }}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<UserCheck size={14} />}
            label="All proxies"
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onOpenFilter={() => setFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={tableData.loading || proxies === undefined}
            renderRowActions={(r) => (
              <>
                {!r.revokedAtISO && (
                  <button className="btn btn--ghost btn--sm" onClick={() => revoke({ id: r._id })}>
                    Revoke
                  </button>
                )}
                <button
                  className="btn btn--ghost btn--sm btn--icon"
                  aria-label={`Delete proxy for ${r.grantorName}`}
                  onClick={() => remove({ id: r._id })}
                >
                  <Trash2 size={12} />
                </button>
              </>
            )}
          />
        </RecordTableScope>
      ) : (
        <div className="record-table__loading">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="record-table__loading-row" />
          ))}
        </div>
      )}

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="New proxy"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" onClick={save}>Save</button></>}
      >
        {form && (
          <div>
            <InspectorNote tone="warn" title="Proxy rules come from your bylaws">
              Confirm the meeting, holder eligibility, and appointment limits before saving. This
              record should match the signed proxy form kept with meeting materials.
            </InspectorNote>
            <Field label="Meeting">
              <select className="input" value={form.meetingId ?? ""} onChange={(e) => setForm({ ...form, meetingId: e.target.value })}>
                {(meetings ?? []).map((m: any) => <option key={m._id} value={m._id}>{m.title}</option>)}
              </select>
            </Field>
            <Field label="Grantor member (optional)">
              <select
                className="input"
                value={form.grantorMemberId ?? ""}
                onChange={(e) => {
                  const member = (members ?? []).find((row: any) => row._id === e.target.value);
                  setForm({
                    ...form,
                    grantorMemberId: e.target.value || undefined,
                    grantorName: member ? `${member.firstName} ${member.lastName}` : form.grantorName,
                  });
                }}
              >
                <option value="">— none —</option>
                {(members ?? []).map((member: any) => (
                  <option key={member._id} value={member._id}>
                    {member.firstName} {member.lastName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Grantor (voting member)"><input className="input" value={form.grantorName} onChange={(e) => setForm({ ...form, grantorName: e.target.value })} /></Field>
            <Field label={`Proxy holder${rules?.proxyHolderMustBeMember ? " member" : " member (optional)"}`}>
              <select
                className="input"
                value={form.proxyHolderMemberId ?? ""}
                onChange={(e) => {
                  const member = (members ?? []).find((row: any) => row._id === e.target.value);
                  setForm({
                    ...form,
                    proxyHolderMemberId: e.target.value || undefined,
                    proxyHolderName: member ? `${member.firstName} ${member.lastName}` : form.proxyHolderName,
                  });
                }}
              >
                <option value="">— none —</option>
                {(members ?? []).map((member: any) => (
                  <option key={member._id} value={member._id}>
                    {member.firstName} {member.lastName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Proxy holder"><input className="input" value={form.proxyHolderName} onChange={(e) => setForm({ ...form, proxyHolderName: e.target.value })} /></Field>
            <Field label="Instructions (optional)"><textarea className="textarea" value={form.instructions ?? ""} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></Field>
            <Field label="Signed on"><input className="input" type="date" value={form.signedAtISO} onChange={(e) => setForm({ ...form, signedAtISO: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}
