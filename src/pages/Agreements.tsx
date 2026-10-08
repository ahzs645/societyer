import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { AlertTriangle, FileSignature, Plus, Wand2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../convex/_generated/dataModel";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge } from "../components/ui";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/platform/record-engine";
import { formatDate, money, relative } from "../lib/format";
import { AGREEMENT_KIND_LABELS, AGREEMENT_STATUS_LABELS, RENEWAL_DECISION_LABELS, type AgreementKind, type AgreementStatus, type RenewalDecision } from "../../shared/agreements";
import { AgreementFormDrawer, emptyAgreementForm, formToPayload, type AgreementFormValue } from "../features/agreements/AgreementFormDrawer";

export function agreementStatusTone(status: string): "success" | "warn" | "danger" | "info" | "neutral" {
  return status === "active" ? "success" : status === "expired" ? "warn" : status === "terminated" ? "danger" : status === "negotiating" ? "info" : "neutral";
}

export function agreementTerm(row: any): string {
  const start = row.effectiveDate ? formatDate(row.effectiveDate) : "";
  const end = row.currentTermEnd ?? row.endDate;
  if (!start && !end) return "Term not recorded";
  return `${start || "?"} – ${end ? formatDate(end) : "open-ended"}${row.autoRenew ? " (renews)" : ""}`;
}

type QuickFilter = "all" | "active" | "expiring" | "review" | "warnings";
const QUICK_FILTER_LABELS: Record<QuickFilter, string> = { all: "all agreements", active: "active agreements", expiring: "agreements expiring in 90 days", review: "agreements that need review", warnings: "agreements with signing warnings" };

export function AgreementsPage() {
  const society = useSociety();
  const { can } = usePermissions();
  const canWrite = can("agreements:write");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const confirm = useConfirm();
  const agreements = useQuery(api.agreements.list, society ? { societyId: society._id } : "skip") as any[] | undefined;
  const preview = useQuery(api.agreements.conversionPreview, society && canWrite && can("documents:write") ? { societyId: society._id } : "skip") as any;
  const create = usePermissionedMutation(api.agreements.create, canWrite);
  const convert = usePermissionedMutation(api.agreements.convertGaps, canWrite);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState("");
  const [converting, setConverting] = useState(false);
  const [quick, setQuick] = useState<QuickFilter>(() => (["active", "expiring", "review", "warnings"].includes(params.get("filter") ?? "") ? (params.get("filter") as QuickFilter) : "all"));
  const setQuickFilter = (value: QuickFilter) => {
    setQuick(value);
    const next = new URLSearchParams(params);
    if (value === "all") next.delete("filter");
    else next.set("filter", value);
    setParams(next, { replace: true });
  };

  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);
  const tableData = useObjectRecordTableData({ societyId: society?._id, nameSingular: "agreement", viewId: currentViewId });
  const initialForm = useMemo(() => emptyAgreementForm(society?.name), [society?.name]);

  useEffect(() => {
    if (params.get("intent") === "add" && canWrite) {
      setDrawerOpen(true);
      const next = new URLSearchParams(params);
      next.delete("intent");
      setParams(next, { replace: true });
    }
  }, [params, setParams, canWrite]);

  const records = useMemo(() => (agreements ?? []).map((row) => ({
    ...row,
    counterparty: (row.counterparties ?? []).join("; "),
    term: agreementTerm(row),
    signing: row.signing ? (row.signing.status === "warning" ? "Check signing authority" : row.signing.status === "ok" ? "Satisfied" : row.signing.status === "no_tiers" ? "No tiers on record" : "No value") : "",
  })), [agreements]);

  const filtered = useMemo(() => records.filter((row) => {
    if (quick === "active" && !["active", "negotiating"].includes(row.effectiveStatus)) return false;
    if (quick === "expiring" && !row.expiringSoon) return false;
    if (quick === "review" && row.reviewStatus !== "NeedsReview") return false;
    if (quick === "warnings" && !row.signingWarning) return false;
    return true;
  }), [records, quick]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const all = records;
  const active = all.filter((row) => row.effectiveStatus === "active");
  const expiring = all.filter((row) => row.expiringSoon);
  const overdue = all.reduce((sum, row) => sum + (row.overdueObligations ?? 0), 0);
  const warnings = all.filter((row) => row.signingWarning);
  const needsReview = all.filter((row) => row.reviewStatus === "NeedsReview");

  const save = async (form: AgreementFormValue) => {
    setSaving(true);
    setServerError("");
    try {
      const { payload } = formToPayload(form);
      const id = await create({ societyId: society._id, ...payload } as any);
      toast.success("Agreement created");
      setDrawerOpen(false);
      navigate(`/app/agreements/${id}`);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Could not save the agreement.");
    } finally {
      setSaving(false);
    }
  };

  const runConversion = async () => {
    if (!preview?.total) return;
    const ok = await confirm({
      title: "Convert agreement gaps to agreements?",
      message: `${preview.total} draft agreement${preview.total === 1 ? "" : "s"} marked "Needs review" will be created from ${preview.gaps} system gap${preview.gaps === 1 ? "" : "s"} and ${preview.extractions} unreviewed intake extraction${preview.extractions === 1 ? "" : "s"}${preview.foldedCopies ? ` (${preview.foldedCopies} more cop${preview.foldedCopies === 1 ? "y or version is" : "ies or versions are"} folded into the agreement they belong to)` : ""}, linked to their source documents. The system gaps are marked resolved. Nothing is marked active; review each draft before relying on it.`,
      confirmLabel: "Convert",
    });
    if (!ok) return;
    setConverting(true);
    try {
      let created = 0, resolved = 0, sources = 0, remaining = preview.total;
      for (let round = 0; round < 20 && remaining > 0; round += 1) {
        const result = await convert({ societyId: society._id, limit: 100 }) as any;
        created += result.created ?? 0;
        resolved += result.resolvedGaps ?? 0;
        sources += result.sourceFiles ?? 0;
        remaining = result.remaining ?? 0;
        if (!result.created) break;
      }
      toast.success(`${created} draft agreement${created === 1 ? "" : "s"} created`, `From ${sources} source file${sources === 1 ? "" : "s"}; ${resolved} system gap${resolved === 1 ? "" : "s"} resolved. Filter by "Needs review" to go through them.`);
      setQuick("review");
    } catch (error) {
      toast.error("Could not convert the gaps", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setConverting(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Agreements"
        icon={<FileSignature size={16} />}
        iconColor="turquoise"
        subtitle="Contracts, funding agreements, leases and MOUs."
        info={<p>Who each agreement is with, when it ends, what it costs and what it requires. The tiles above the table filter it.</p>}
        actions={
          <button type="button" className="btn-action btn-action--primary" onClick={() => { setServerError(""); setDrawerOpen(true); }} disabled={!canWrite}>
            <Plus size={12} /> New agreement
          </button>
        }
      />

      {preview?.total > 0 && (
        <div className="banner banner--warn" role="status" style={{ marginBottom: 12 }}>
          <AlertTriangle size={14} aria-hidden="true" />
          <div style={{ flex: 1 }}>
            <strong>{preview.total} agreement{preview.total === 1 ? " is" : "s are"} only recorded as system gaps or unreviewed intake extractions.</strong>{" "}
            Convert them into draft agreements to review them here{preview.examples?.length ? ` (for example: ${preview.examples.slice(0, 2).join("; ")})` : ""}.
          </div>
          <button type="button" className="btn btn--sm" onClick={runConversion} disabled={converting}>
            <Wand2 size={12} /> {converting ? "Converting…" : "Convert agreement gaps to agreements"}
          </button>
        </div>
      )}

      <div className="stat-grid">
        {([
          { id: "active", label: "Active", value: active.length, sub: overdue ? `${overdue} overdue obligation${overdue === 1 ? "" : "s"}` : `of ${all.length} agreements` },
          { id: "expiring", label: "Expiring in 90 days", value: expiring.length, sub: `${expiring.filter((row) => !row.renewalDecided).length} without a renewal decision` },
          { id: "review", label: "Needs review", value: needsReview.length, sub: "imported or converted drafts" },
          { id: "warnings", label: "Signing warnings", value: warnings.length, sub: "tier not satisfied" },
        ] as { id: QuickFilter; label: string; value: number; sub: string }[]).map((tile) => (
          <button
            key={tile.id}
            type="button"
            className="stat"
            aria-pressed={quick === tile.id}
            onClick={() => setQuickFilter(quick === tile.id ? "all" : tile.id)}
            style={{ textAlign: "left", font: "inherit", color: "inherit", cursor: "pointer", borderColor: quick === tile.id ? "var(--accent)" : undefined, boxShadow: quick === tile.id ? "0 0 0 1px var(--accent)" : undefined }}
          >
            <span className="stat__label">{tile.label}</span>
            <span className="stat__value">{tile.value}</span>
            {tile.value > 0 && <span className="stat__sub">{tile.sub}</span>}
          </button>
        ))}
      </div>

      {quick !== "all" && (
        <div className="row" style={{ gap: 8, alignItems: "center", margin: "0 0 8px", fontSize: "var(--fs-sm)" }}>
          <span className="muted">Filtered to {QUICK_FILTER_LABELS[quick]}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setQuickFilter("all")}>All ({all.length})</button>
        </div>
      )}

      {!tableData.loading && !tableData.objectMetadata ? (
        <RecordTableMetadataEmpty societyId={society._id} objectLabel="agreement" />
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="agreements"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={filtered}
          onRecordClick={(recordId) => navigate(`/app/agreements/${recordId}`)}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<FileSignature size={14} />}
            label="All agreements"
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onOpenFilter={() => setFilterOpen((open) => !open)}
          />
          <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={tableData.loading || agreements === undefined}
            emptyState={all.length ? "No agreements match these filters." : "No agreements yet. Add one, or convert agreements recorded as system gaps."}
            renderCell={({ record: row, field }) => {
              if (field.name === "title") return (
                <span title={row.agreementNumber ? `${row.title} · ${row.agreementNumber}` : row.title} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <Link to={`/app/agreements/${row._id}`} onClick={(event) => event.stopPropagation()}><strong>{row.title}</strong></Link>
                  {row.agreementNumber && <span className="muted" style={{ fontWeight: 400 }}> · {row.agreementNumber}</span>}
                </span>
              );
              if (field.name === "effectiveStatus") return <Badge tone={agreementStatusTone(row.effectiveStatus)}>{AGREEMENT_STATUS_LABELS[row.effectiveStatus as AgreementStatus] ?? row.effectiveStatus}</Badge>;
              if (field.name === "counterparty") return row.counterparty ? <span>{row.counterparty}</span> : <span className="muted">Not identified</span>;
              if (field.name === "kind") return <span>{AGREEMENT_KIND_LABELS[row.kind as AgreementKind] ?? row.kind ?? "—"}</span>;
              if (field.name === "term") return <span className="muted" title={row.term}>{row.term}</span>;
              if (field.name === "valueCents") return row.valueCents === undefined ? <span className="muted">—</span> : <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(row.valueCents)}{row.currency && row.currency !== "CAD" ? ` ${row.currency}` : ""}</span>;
              if (field.name === "renewalDue") {
                if (!row.renewalDue) return <span className="muted">—</span>;
                return (
                  <div>
                    <span>{formatDate(row.renewalDue)}</span>
                    <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                      {row.renewalDecided ? `Decided: ${RENEWAL_DECISION_LABELS[(row.renewalDecision?.decision ?? "renew") as RenewalDecision] ?? "yes"}` : relative(row.renewalDue)}
                    </div>
                  </div>
                );
              }
              if (field.name === "signing") {
                if (!row.signing) return <span className="muted">—</span>;
                if (row.signing.status === "warning") return <span title={row.signing.issues?.join(" ")}><Badge tone="warn"><AlertTriangle size={10} aria-hidden="true" /> Check signing authority</Badge></span>;
                if (row.signing.status === "ok") return <Badge tone="success">Satisfied</Badge>;
                return <span className="muted">{row.signing.status === "no_tiers" ? "No tiers on record" : "No value"}</span>;
              }
              if (field.name === "reviewStatus") return row.reviewStatus ? <Badge tone={row.reviewStatus === "NeedsReview" ? "warn" : row.reviewStatus === "Verified" ? "success" : "danger"}>{row.reviewStatus === "NeedsReview" ? "Needs review" : row.reviewStatus}</Badge> : <span className="muted">—</span>;
              return undefined;
            }}
          />
        </RecordTableScope>
      ) : null}

      <AgreementFormDrawer
        open={drawerOpen}
        title="New agreement"
        societyId={society._id}
        initial={initialForm}
        saving={saving}
        serverError={serverError}
        onClose={() => setDrawerOpen(false)}
        onSubmit={save}
      />
    </div>
  );
}
