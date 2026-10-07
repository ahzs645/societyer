import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { CalendarCheck, Save } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Field } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { DatePicker } from "../../../components/DatePicker";
import { useToast } from "../../../components/Toast";
import { formatDate } from "../../../lib/format";

const MEETING_TYPE_ORDER: Record<string, number> = { AGM: 0, SGM: 1, Board: 2 };

/**
 * Records where a year's financial statements were approved and presented:
 * the board approval date, the members' meeting (usually the AGM) at which
 * they were presented, and the statements document itself.
 * Backs `financials.approvedByBoardAt`, `presentedAtMeetingId` and
 * `statementsDocId` (schema finding B7).
 */
export function FinancialPresentationCard({
  societyId,
  financial,
  canWrite,
}: {
  societyId: string;
  financial: any;
  canWrite: boolean;
}) {
  const toast = useToast();
  const meetings = useQuery(api.meetings.list, { societyId });
  const documents = useQuery(api.documents.list, { societyId });
  const update = useMutation(api.financials.update);
  const [form, setForm] = useState({ presentedAtMeetingId: "", statementsDocId: "", approvedByBoardAt: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      presentedAtMeetingId: financial?.presentedAtMeetingId ?? "",
      statementsDocId: financial?.statementsDocId ?? "",
      approvedByBoardAt: financial?.approvedByBoardAt ? String(financial.approvedByBoardAt).slice(0, 10) : "",
    });
  }, [financial?._id, financial?.presentedAtMeetingId, financial?.statementsDocId, financial?.approvedByBoardAt]);

  const periodEnd = String(financial?.periodEnd ?? "");
  const meetingOptions = useMemo(() => {
    const rows = ((meetings ?? []) as any[])
      .slice()
      .sort((a, b) =>
        // Meetings after the period end first (statements are presented after
        // year end), members' meetings before board meetings, newest first.
        Number(String(b.scheduledAt ?? "") >= periodEnd) - Number(String(a.scheduledAt ?? "") >= periodEnd) ||
        (MEETING_TYPE_ORDER[a.type] ?? 9) - (MEETING_TYPE_ORDER[b.type] ?? 9) ||
        String(b.scheduledAt ?? "").localeCompare(String(a.scheduledAt ?? "")));
    return [
      { value: "", label: "Not recorded" },
      ...rows.map((meeting) => ({
        value: String(meeting._id),
        label: `${meeting.scheduledAt ? formatDate(meeting.scheduledAt) : "Undated"} · ${meeting.type ?? "Meeting"} · ${meeting.title}`,
      })),
    ];
  }, [meetings, periodEnd]);
  const documentOptions = useMemo(() => {
    const rows = ((documents ?? []) as any[])
      .slice()
      .sort((a, b) => Number(/financ/i.test(String(b.category ?? ""))) - Number(/financ/i.test(String(a.category ?? ""))) || String(a.title).localeCompare(String(b.title)));
    return [{ value: "", label: "No statements document" }, ...rows.map((doc) => ({ value: String(doc._id), label: doc.title }))];
  }, [documents]);

  const dirty =
    form.presentedAtMeetingId !== (financial?.presentedAtMeetingId ?? "") ||
    form.statementsDocId !== (financial?.statementsDocId ?? "") ||
    form.approvedByBoardAt !== (financial?.approvedByBoardAt ? String(financial.approvedByBoardAt).slice(0, 10) : "");

  const save = async () => {
    if (!financial || saving) return;
    setSaving(true);
    try {
      const patch: Record<string, string> = {};
      const clear: string[] = [];
      for (const field of ["presentedAtMeetingId", "statementsDocId", "approvedByBoardAt"] as const) {
        if (form[field]) patch[field] = form[field];
        else clear.push(field);
      }
      await update({ id: financial._id, patch: patch as any, clear });
      toast.success("Presentation details saved", `FY ${financial.fiscalYear}`);
    } catch (error: any) {
      toast.error("Could not save presentation details", error?.data?.message ?? error?.message);
    } finally {
      setSaving(false);
    }
  };

  if (!financial) return null;
  const selectedMeeting = ((meetings ?? []) as any[]).find((meeting) => String(meeting._id) === form.presentedAtMeetingId);
  const selectedDocument = ((documents ?? []) as any[]).find((doc) => String(doc._id) === form.statementsDocId);

  return (
    <div className="card" data-testid="financial-presentation-card">
      <div className="card__head">
        <h2 className="card__title"><CalendarCheck size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Approval and presentation</h2>
      </div>
      <div className="card__body col">
        <Field label="Board approval date">
          <DatePicker value={form.approvedByBoardAt} onChange={(value) => setForm({ ...form, approvedByBoardAt: value })} disabled={!canWrite} />
        </Field>
        <Field label="Presented at meeting" hint="Usually the AGM after the year end, where members receive the statements.">
          <Select
            value={form.presentedAtMeetingId}
            onChange={(value) => setForm({ ...form, presentedAtMeetingId: value })}
            options={meetingOptions}
            searchable
            disabled={!canWrite || meetings === undefined}
          />
        </Field>
        {selectedMeeting && <Link to={`/app/meetings/${selectedMeeting._id}`} className="muted" style={{ fontSize: 12 }}>Open {selectedMeeting.title}</Link>}
        <Field label="Statements document">
          <Select
            value={form.statementsDocId}
            onChange={(value) => setForm({ ...form, statementsDocId: value })}
            options={documentOptions}
            searchable
            disabled={!canWrite || documents === undefined}
          />
        </Field>
        {selectedDocument && <Link to={`/app/documents/${selectedDocument._id}`} className="muted" style={{ fontSize: 12 }}>Open {selectedDocument.title}</Link>}
        {canWrite && (
          <div>
            <button className="btn btn--accent btn--sm" onClick={() => void save()} disabled={!dirty || saving}>
              <Save size={12} /> {saving ? "Saving…" : "Save"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
