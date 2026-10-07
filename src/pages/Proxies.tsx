import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { usePermissions } from "../hooks/usePermissions";
import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Drawer, Field, InspectorNote } from "../components/ui";
import { Select } from "../components/Select";
import { Plus, UserCheck, Trash2 } from "lucide-react";
import { useBylawRules } from "../hooks/useBylawRules";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { DatePicker } from "../components/DatePicker";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/platform/record-engine";
import type { Id } from "../../convex/_generated/dataModel";
import { todayDateOnly } from "../../shared/dateOnly";

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
  const permissions = usePermissions();
  const canWrite = permissions.loaded && permissions.can("proxies:write");
  const { rules } = useBylawRules();
  const meetings = useQuery(api.meetings.list, society ? { societyId: society._id } : "skip");
  const members = useQuery(api.members.list, society ? { societyId: society._id } : "skip");
  const proxies = useQuery(api.proxies.list, society ? { societyId: society._id } : "skip");
  const create = usePermissionedMutation(api.proxies.create, canWrite);
  const update = usePermissionedMutation(api.proxies.update, canWrite);
  const revoke = usePermissionedMutation(api.proxies.revoke, canWrite);
  const remove = usePermissionedMutation(api.proxies.remove, canWrite);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    if (!canWrite) setOpen(false);
  }, [canWrite]);

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

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    if (!canWrite || !rules?.allowProxyVoting) return;
    setForm({
      meetingId: meetings?.[0]?._id,
      grantorName: "",
      proxyHolderName: "",
      signedAtISO: todayDateOnly(),
    });
    setOpen(true);
  };
  const save = async () => {
    if (!canWrite || !rules?.allowProxyVoting) return;
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
          <button className="btn-action btn-action--primary" onClick={openNew} disabled={!canWrite || !rules?.allowProxyVoting}>
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
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="proxy" />
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="proxies"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
          onUpdate={canWrite ? async ({ recordId, fieldName, value }) => {
            if (!canWrite) return;
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
          } : undefined}
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
                  <button className="btn btn--ghost btn--sm" disabled={!canWrite} onClick={() => revoke({ id: r._id })}>
                    Revoke
                  </button>
                )}
                <button
                  className="btn btn--ghost btn--sm btn--icon"
                  aria-label={`Delete proxy for ${r.grantorName}`}
                  disabled={!canWrite} onClick={() => remove({ id: r._id })}
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
        open={open && canWrite}
        onClose={() => setOpen(false)}
        title="New proxy"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" onClick={save} disabled={!canWrite}>Save</button></>}
      >
        {form && (
          <div>
            <InspectorNote tone="warn" title="Proxy rules come from your bylaws">
              Confirm the meeting, holder eligibility, and appointment limits before saving. This
              record should match the signed proxy form kept with meeting materials.
            </InspectorNote>
            <Field label="Meeting">
              <Select
                value={form.meetingId ?? ""}
                onChange={(value) => setForm({ ...form, meetingId: value })}
                options={(meetings ?? []).map((m: any) => ({ value: m._id, label: m.title }))}
              />
            </Field>
            <Field label="Grantor member (optional)">
              <Select
                value={form.grantorMemberId ?? ""}
                onChange={(value) => {
                  const member = (members ?? []).find((row: any) => row._id === value);
                  setForm({
                    ...form,
                    grantorMemberId: value || undefined,
                    grantorName: member ? `${member.firstName} ${member.lastName}` : form.grantorName,
                  });
                }}
                options={[
                  { value: "", label: "— none —" },
                  ...(members ?? []).map((member: any) => ({ value: member._id, label: `${member.firstName} ${member.lastName}` })),
                ]}
              />
            </Field>
            <Field label="Grantor (voting member)"><input className="input" value={form.grantorName} onChange={(e) => setForm({ ...form, grantorName: e.target.value })} /></Field>
            <Field label={`Proxy holder${rules?.proxyHolderMustBeMember ? " member" : " member (optional)"}`}>
              <Select
                value={form.proxyHolderMemberId ?? ""}
                onChange={(value) => {
                  const member = (members ?? []).find((row: any) => row._id === value);
                  setForm({
                    ...form,
                    proxyHolderMemberId: value || undefined,
                    proxyHolderName: member ? `${member.firstName} ${member.lastName}` : form.proxyHolderName,
                  });
                }}
                options={[
                  { value: "", label: "— none —" },
                  ...(members ?? []).map((member: any) => ({ value: member._id, label: `${member.firstName} ${member.lastName}` })),
                ]}
              />
            </Field>
            <Field label="Proxy holder"><input className="input" value={form.proxyHolderName} onChange={(e) => setForm({ ...form, proxyHolderName: e.target.value })} /></Field>
            <Field label="Instructions (optional)"><MarkdownEditor rows={4} value={form.instructions ?? ""} onChange={(markdown) => setForm({ ...form, instructions: markdown })} /></Field>
            <Field label="Signed on"><DatePicker value={form.signedAtISO} onChange={(value) => setForm({ ...form, signedAtISO: value })} /></Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}
