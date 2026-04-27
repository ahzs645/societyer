import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Button, Drawer, Field } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { OptionSelect } from "../components/OptionSelect";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { BookOpen, Plus, Trash2 } from "lucide-react";
import { formatDate } from "../lib/format";
import { optionLabel } from "../lib/orgHubOptions";

export function MinuteBookPage() {
  const society = useSociety();
  const detail = useQuery(api.minuteBook.overview, society ? { societyId: society._id } : "skip");
  const upsert = useMutation(api.minuteBook.upsert);
  const remove = useMutation(api.minuteBook.remove);
  const confirm = useConfirm();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<any>(null);
  const [params, setParams] = useSearchParams();

  const maps = useMemo(() => {
    const d = detail ?? {};
    return {
      documents: new Map<string, any>((d.documents ?? []).map((row: any) => [row._id, row])),
      meetings: new Map<string, any>((d.meetings ?? []).map((row: any) => [row._id, row])),
      minutes: new Map<string, any>((d.minutes ?? []).map((row: any) => [row._id, row])),
      filings: new Map<string, any>((d.filings ?? []).map((row: any) => [row._id, row])),
      policies: new Map<string, any>((d.policies ?? []).map((row: any) => [row._id, row])),
      workflowPackages: new Map<string, any>((d.workflowPackages ?? []).map((row: any) => [row._id, row])),
      writtenResolutions: new Map<string, any>((d.writtenResolutions ?? []).map((row: any) => [row._id, row])),
    };
  }, [detail]);

  useEffect(() => {
    if (!society || params.get("intent") !== "export") return;
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("intent");
      return next;
    }, { replace: true });
    toast.info("Minute book export", "Use Data export for now; the minute-book spine is ready for export packaging.");
  }, [params, setParams, society, toast]);

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setDraft({
      title: "",
      recordType: "minute_book_record",
      status: "NeedsReview",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!draft) return;
    await upsert({
      id: draft._id,
      societyId: society._id,
      title: draft.title || "Untitled record",
      recordType: draft.recordType || "minute_book_record",
      effectiveDate: draft.effectiveDate || undefined,
      status: draft.status || "NeedsReview",
      documentIds: draft.documentId ? [draft.documentId] : draft.documentIds ?? [],
      meetingId: draft.meetingId || undefined,
      minutesId: draft.minutesId || undefined,
      filingId: draft.filingId || undefined,
      policyId: draft.policyId || undefined,
      workflowPackageId: draft.workflowPackageId || undefined,
      writtenResolutionId: draft.writtenResolutionId || undefined,
      signatureIds: draft.signatureIds ?? [],
      sourceEvidenceIds: draft.sourceEvidenceIds ?? [],
      archivedAtISO: draft.archivedAtISO || undefined,
      notes: draft.notes || undefined,
    });
    setOpen(false);
    setDraft(null);
    toast.success("Minute book record saved");
  };

  const confirmDelete = async (row: any) => {
    const ok = await confirm({
      title: "Delete minute book record?",
      message: `"${row.title}" will be removed from the minute book spine.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    await remove({ id: row._id });
    toast.success("Minute book record deleted");
  };

  const items = Array.isArray(detail) ? [] : detail?.items ?? [];
  const checks = safeRows(detail, "checks");
  const recordBundles = safeRows(detail, "recordBundles");
  const openCheckCount = checks.filter((check: any) => !check.ok).length;
  const bundleGapCount = recordBundles.reduce((count: number, row: any) => count + actionableGaps(row.gaps).length, 0);

  return (
    <div className="page page--wide">
      <PageHeader
        title="Minute book"
        icon={<BookOpen size={16} />}
        iconColor="purple"
        subtitle="A legal record spine tying documents, meetings, minutes, resolutions, filings, signatures, policies, and workflow packages together."
        actions={
          <Button variant="accent" icon={<Plus size={14} />} onClick={openNew}>New record</Button>
        }
      />

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <Stat label="Connected records" value={recordBundles.length} />
        <Stat label="Manual records" value={items.length} />
        <Stat label="Documents" value={safeCount(detail, "documents")} />
        <Stat label="Meetings" value={safeCount(detail, "meetings")} />
        <Stat label="Record gaps" value={bundleGapCount} tone={bundleGapCount ? "warn" : undefined} />
        <Stat label="Open checks" value={openCheckCount} tone={openCheckCount ? "warn" : undefined} />
      </div>

      <RecordBundlesCard rows={recordBundles} />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <h2 className="card__title">Completeness checks</h2>
          <Badge tone={openCheckCount ? "warn" : "success"}>{openCheckCount ? `${openCheckCount} open` : "Clear"}</Badge>
        </div>
        <div className="card__body">
          <div className="grid two">
            {checks.map((check: any) => (
              <div key={check.key} className="row" style={{ alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <strong>{check.label}</strong>
                  <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{check.detail}</div>
                </div>
                <Badge tone={check.ok ? "success" : check.severity === "danger" ? "danger" : check.severity === "warn" ? "warn" : "info"}>
                  {check.count}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <h2 className="card__title">Record spine</h2>
          <Badge>{items.length}</Badge>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Record</th>
                <th>Linked source</th>
                <th>Effective</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((row: any) => (
                <tr key={row._id}>
                  <td>
                    <strong>{row.title}</strong>
                    <div className="muted">{optionLabel("minuteBookRecordTypes", row.recordType)}</div>
                  </td>
                  <td>{linkSummary(row, maps)}</td>
                  <td>{row.effectiveDate ? formatDate(row.effectiveDate) : "-"}</td>
                  <td><Badge tone={toneForStatus(row.status)}>{optionLabel("minuteBookStatuses", row.status)}</Badge></td>
                  <td>
                    <div className="row" style={{ justifyContent: "flex-end" }}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setDraft({ ...row, documentId: row.documentIds?.[0] });
                          setOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Trash2 size={12} />}
                        iconOnly
                        aria-label="Delete minute book record"
                        onClick={() => confirmDelete(row)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={5} className="muted" style={{ textAlign: "center", padding: 24 }}>No manual minute book records yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid two">
        <LinkedList title="Canonical documents" rows={safeRows(detail, "documents")} getTitle={(row: any) => row.title} getMeta={(row: any) => row.category} />
        <LinkedList title="Meetings and minutes" rows={safeRows(detail, "meetings")} getTitle={(row: any) => row.title} getMeta={(row: any) => `${row.type} - ${row.scheduledAt ? formatDate(row.scheduledAt) : "unscheduled"}`} />
        <LinkedList title="Filings" rows={safeRows(detail, "filings")} getTitle={(row: any) => row.kind} getMeta={(row: any) => `${row.status} - ${row.dueDate ? formatDate(row.dueDate) : "no due date"}`} />
        <LinkedList title="Policies and workflow packages" rows={[...safeRows(detail, "policies"), ...safeRows(detail, "workflowPackages")]} getTitle={(row: any) => row.policyName ?? row.packageName} getMeta={(row: any) => row.status ?? row.eventType} />
      </div>

      <Drawer
        open={open}
        onClose={() => { setOpen(false); setDraft(null); }}
        title={draft?._id ? "Edit minute book record" : "New minute book record"}
        footer={
          <>
            <Button onClick={() => { setOpen(false); setDraft(null); }}>Cancel</Button>
            <Button variant="accent" onClick={save}>Save</Button>
          </>
        }
      >
        {draft && (
          <>
            <Field label="Title"><input className="input" value={draft.title ?? ""} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <OptionSelect label="Record type" setName="minuteBookRecordTypes" value={draft.recordType ?? ""} onChange={(value) => setDraft({ ...draft, recordType: value })} />
              <OptionSelect label="Status" setName="minuteBookStatuses" value={draft.status ?? ""} onChange={(value) => setDraft({ ...draft, status: value })} />
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Effective date"><DatePicker value={draft.effectiveDate ?? ""} onChange={(value) => setDraft({ ...draft, effectiveDate: value })} /></Field>
              <Field label="Archived date"><DatePicker value={draft.archivedAtISO ?? ""} onChange={(value) => setDraft({ ...draft, archivedAtISO: value })} /></Field>
            </div>
            <RecordSelect label="Document" value={draft.documentId} rows={safeRows(detail, "documents")} onChange={(value) => setDraft({ ...draft, documentId: value })} getLabel={(row: any) => row.title} />
            <RecordSelect label="Meeting" value={draft.meetingId} rows={safeRows(detail, "meetings")} onChange={(value) => setDraft({ ...draft, meetingId: value })} getLabel={(row: any) => row.title} />
            <RecordSelect label="Minutes" value={draft.minutesId} rows={safeRows(detail, "minutes")} onChange={(value) => setDraft({ ...draft, minutesId: value })} getLabel={(row: any) => `${row.heldAt ?? "Minutes"} - ${row.status ?? ""}`} />
            <RecordSelect label="Filing" value={draft.filingId} rows={safeRows(detail, "filings")} onChange={(value) => setDraft({ ...draft, filingId: value })} getLabel={(row: any) => row.kind} />
            <RecordSelect label="Policy" value={draft.policyId} rows={safeRows(detail, "policies")} onChange={(value) => setDraft({ ...draft, policyId: value })} getLabel={(row: any) => row.policyName} />
            <RecordSelect label="Workflow package" value={draft.workflowPackageId} rows={safeRows(detail, "workflowPackages")} onChange={(value) => setDraft({ ...draft, workflowPackageId: value })} getLabel={(row: any) => row.packageName} />
            <RecordSelect label="Written resolution" value={draft.writtenResolutionId} rows={safeRows(detail, "writtenResolutions")} onChange={(value) => setDraft({ ...draft, writtenResolutionId: value })} getLabel={(row: any) => row.title} />
            <Field label="Notes"><textarea className="textarea" value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field>
          </>
        )}
      </Drawer>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value" style={{ color: tone === "warn" ? "var(--warn)" : undefined }}>{value}</div>
    </div>
  );
}

function RecordBundlesCard({ rows }: { rows: any[] }) {
  const gapCount = rows.reduce((count, row) => count + actionableGaps(row.gaps).length, 0);
  const visibleRows = rows
    .slice()
    .sort((a, b) => {
      const gapDifference = gapScore(b.gaps) - gapScore(a.gaps);
      if (gapDifference !== 0) return gapDifference;
      return String(b.date ?? "").localeCompare(String(a.date ?? ""));
    })
    .slice(0, 40);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card__head">
        <h2 className="card__title">Connected records</h2>
        <Badge tone={gapCount ? "warn" : "success"}>{gapCount ? `${gapCount} gaps` : `${rows.length} records`}</Badge>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Record</th>
              <th>Connected evidence</th>
              <th>Counts</th>
              <th>Gaps</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.key}>
                <td>
                  <div>{row.href ? <Link to={row.href}><strong>{row.title}</strong></Link> : <strong>{row.title}</strong>}</div>
                  <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                    <Badge>{labelize(row.type)}</Badge>
                    {(row.badges ?? []).slice(0, 3).map((badge: any) => <Badge key={`${row.key}:${badge.label}`} tone={badge.tone}>{badge.label}</Badge>)}
                  </div>
                </td>
                <td><BundleLinks links={row.links ?? []} /></td>
                <td><CountBadges counts={row.counts ?? {}} /></td>
                <td><GapBadges gaps={row.gaps ?? []} /></td>
                <td><Badge tone={toneForStatus(row.status)}>{row.status ?? "-"}</Badge></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="muted" style={{ textAlign: "center", padding: 24 }}>No connected record bundles yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 40 && <div className="card__body muted">Showing the first 40 connected records.</div>}
    </div>
  );
}

function BundleLinks({ links }: { links: any[] }) {
  if (!links.length) return <span className="muted">No linked evidence</span>;
  return (
    <div style={{ display: "grid", gap: 4 }}>
      {links.slice(0, 5).map((link) => (
        <div key={`${link.kind}:${link.label}`} style={{ fontSize: "var(--fs-sm)" }}>
          <Link to={link.href}>{link.kind}</Link>
          <span className="muted"> - {link.label}</span>
        </div>
      ))}
      {links.length > 5 && <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>+{links.length - 5} more links</div>}
    </div>
  );
}

function CountBadges({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).filter(([, value]) => Number(value) > 0);
  if (!entries.length) return <span className="muted">No counts</span>;
  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      {entries.slice(0, 6).map(([key, value]) => <Badge key={key}>{labelize(key)} {value}</Badge>)}
    </div>
  );
}

function GapBadges({ gaps }: { gaps: any[] }) {
  const visibleGaps = actionableGaps(gaps);
  if (!visibleGaps.length) return <Badge tone="success">No gaps</Badge>;
  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      {visibleGaps.slice(0, 4).map((gap) => (
        <Badge key={gap.key} tone={gap.severity === "danger" ? "danger" : gap.severity === "warn" ? "warn" : "info"}>{gap.label}</Badge>
      ))}
      {visibleGaps.length > 4 && <Badge tone="warn">+{visibleGaps.length - 4}</Badge>}
    </div>
  );
}

function actionableGaps(gaps: any[] = []) {
  return gaps.filter((gap) => gap.severity === "warn" || gap.severity === "danger");
}

function gapScore(gaps: any[] = []) {
  return gaps.reduce((score, gap) => {
    if (gap.severity === "danger") return score + 3;
    if (gap.severity === "warn") return score + 2;
    return score;
  }, 0);
}

function LinkedList({ title, rows, getTitle, getMeta }: any) {
  return (
    <div className="card">
      <div className="card__head">
        <h2 className="card__title">{title}</h2>
        <Badge>{rows.length}</Badge>
      </div>
      <div className="card__body">
        {rows.slice(0, 8).map((row: any) => (
          <div key={row._id} className="row" style={{ justifyContent: "space-between", gap: 12, padding: "6px 0" }}>
            <span>{getTitle(row)}</span>
            <span className="muted">{getMeta(row)}</span>
          </div>
        ))}
        {rows.length === 0 && <div className="muted">No records yet.</div>}
      </div>
    </div>
  );
}

function RecordSelect({ label, value, rows, onChange, getLabel }: any) {
  return (
    <Field label={label}>
      <select className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">No {label.toLowerCase()}</option>
        {rows.map((row: any) => <option key={row._id} value={row._id}>{getLabel(row)}</option>)}
      </select>
    </Field>
  );
}

function linkSummary(row: any, maps: any) {
  const document = row.documentIds?.[0] ? maps.documents.get(row.documentIds[0]) : null;
  if (document) return <Link to="/app/documents">{document.title}</Link>;
  const meeting = row.meetingId ? maps.meetings.get(row.meetingId) : null;
  if (meeting) return <Link to={`/app/meetings/${meeting._id}`}>{meeting.title}</Link>;
  const minutes = row.minutesId ? maps.minutes.get(row.minutesId) : null;
  if (minutes) return <Link to="/app/minutes">{minutes.heldAt ?? "Minutes"}</Link>;
  const filing = row.filingId ? maps.filings.get(row.filingId) : null;
  if (filing) return <Link to="/app/filings">{filing.kind}</Link>;
  const policy = row.policyId ? maps.policies.get(row.policyId) : null;
  if (policy) return <Link to="/app/policies">{policy.policyName}</Link>;
  const workflowPackage = row.workflowPackageId ? maps.workflowPackages.get(row.workflowPackageId) : null;
  if (workflowPackage) return <Link to="/app/workflow-packages">{workflowPackage.packageName}</Link>;
  const writtenResolution = row.writtenResolutionId ? maps.writtenResolutions.get(row.writtenResolutionId) : null;
  if (writtenResolution) return <Link to="/app/written-resolutions">{writtenResolution.title}</Link>;
  return <span className="muted">Not linked</span>;
}

function safeRows(detail: any, key: string) {
  if (!detail || Array.isArray(detail)) return [];
  return detail[key] ?? [];
}

function safeCount(detail: any, key: string) {
  return safeRows(detail, key).length;
}

function labelize(value?: string) {
  return String(value ?? "-").replace(/_/g, " ");
}

function toneForStatus(status?: string) {
  const value = String(status ?? "").toLowerCase();
  if (value.includes("current") || value.includes("active") || value.includes("approved") || value.includes("verified") || value.includes("filed") || value.includes("complete") || value.includes("carried") || value.includes("ready")) return "success" as const;
  if (value.includes("review") || value.includes("draft") || value.includes("pending") || value.includes("circulating") || value.includes("collecting")) return "warn" as const;
  if (value.includes("archiv") || value.includes("reject") || value.includes("failed") || value.includes("cancelled") || value.includes("superseded") || value.includes("ceased")) return "danger" as const;
  return "neutral" as const;
}
