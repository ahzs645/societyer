import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field, Flag, InspectorNote, RecordChip } from "../components/ui";
import { ShieldCheck, PenLine } from "lucide-react";
import { formatDate, initials } from "../lib/format";
import { DIRECTOR_ATTESTATION_COPY, LEGAL_COPY_REVIEWED } from "../lib/legalCopy";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import {
  RecordTable,
  RecordTableScope,
  RecordTableToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/modules/object-record";
import type { Id } from "../../convex/_generated/dataModel";

/**
 * Director attestations. Each table row is a director × current-year
 * attestation join — attestations are written by the sign-drawer, not
 * edited inline, so the whole grid stays read-only. The "name" column
 * gets a `renderCell` override to keep the avatar+RecordChip we had
 * before.
 */
export function AttestationsPage() {
  const society = useSociety();
  const year = new Date().getFullYear();
  const directors = useQuery(api.directors.list, society ? { societyId: society._id } : "skip");
  const attestations = useQuery(api.attestations.list, society ? { societyId: society._id } : "skip");
  const missing = useQuery(
    api.attestations.missingForYear,
    society ? { societyId: society._id, year } : "skip",
  );
  const sign = useMutation(api.attestations.sign);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [params, setParams] = useSearchParams();
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "directorAttestation",
    viewId: currentViewId,
  });

  // Project a flat row per Active director (joined with their
  // current-year attestation, if any). The RecordTable doesn't know
  // how to follow relations, so the page does the join client-side.
  const records = useMemo(() => {
    const signedByDirYear = new Map<string, any>();
    (attestations ?? []).forEach((a: any) => signedByDirYear.set(`${a.directorId}-${a.year}`, a));
    return (directors ?? [])
      .filter((d: any) => d.status === "Active")
      .map((d: any) => {
        const a = signedByDirYear.get(`${d._id}-${year}`);
        return {
          _id: d._id,
          name: `${d.firstName} ${d.lastName}`,
          position: d.position,
          signed: !!a,
          signedAtISO: a?.signedAtISO,
          allTrue:
            a &&
            a.isAtLeast18 &&
            a.notBankrupt &&
            a.notDisqualified &&
            a.stillResidentOrEligible,
          director: d,
        };
      });
  }, [directors, attestations, year]);

  const openSign = (directorId: string) => {
    setForm({
      directorId,
      year,
      isAtLeast18: true,
      notBankrupt: true,
      notDisqualified: true,
      stillResidentOrEligible: true,
      notes: "",
    });
    setOpen(true);
  };
  const save = async () => {
    await sign({ societyId: society._id, ...form });
    setOpen(false);
  };

  useEffect(() => {
    if (!society || open || missing === undefined) return;
    if (params.get("intent") !== "request") return;
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("intent");
      return next;
    }, { replace: true });
    const firstMissing = missing?.[0];
    if (firstMissing?.directorId) openSign(String(firstMissing.directorId));
  }, [missing, open, params, setParams, society]);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

  return (
    <div className="page">
      <PageHeader
        title={`Director attestations · ${year}`}
        icon={<ShieldCheck size={16} />}
        iconColor="red"
        subtitle={`${DIRECTOR_ATTESTATION_COPY.subtitle} ${LEGAL_COPY_REVIEWED}.`}
      />

      {missing && missing.length > 0 && (
        <div className="col" style={{ marginBottom: 16, gap: 6 }}>
          <Flag level="warn" citationId="BC-SOC-DIRECTOR-QUALIFICATIONS">
            {missing.length} director{missing.length === 1 ? "" : "s"} have not yet attested for {year}.
          </Flag>
        </div>
      )}

      {showMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="director-attestation" />
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="attestations"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
        >
          <RecordTableToolbar
            icon={<ShieldCheck size={14} />}
            label={`Attestations · ${year}`}
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onOpenFilter={() => setFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={tableData.loading || directors === undefined || attestations === undefined}
            renderCell={({ record, field, value }) => {
              if (field.name === "name") {
                return (
                  <RecordChip
                    tone="blue"
                    avatar={initials(record.director.firstName, record.director.lastName)}
                    label={String(value ?? "")}
                  />
                );
              }
              if (field.name === "signed") {
                if (!record.signed) return <Badge tone="warn">Not signed</Badge>;
                if (record.allTrue) {
                  return <Badge tone="success">Attested {formatDate(record.signedAtISO)}</Badge>;
                }
                return <Badge tone="danger">Attested with issues</Badge>;
              }
              return undefined;
            }}
            renderRowActions={(r) => (
              <button className="btn-action btn-action--primary" onClick={() => openSign(String(r._id))}>
                <PenLine size={12} /> {r.signed ? "Re-sign" : "Sign"}
              </button>
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
        title={`Annual attestation · ${year}`}
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn--accent" onClick={save}>Sign</button>
          </>
        }
      >
        {form && (
          <div>
            <InspectorNote tone="warn" title="Qualification check">
              {DIRECTOR_ATTESTATION_COPY.note}
            </InspectorNote>
            <label className="checkbox"><input type="checkbox" checked={form.isAtLeast18} onChange={(e) => setForm({ ...form, isAtLeast18: e.target.checked })} /> {DIRECTOR_ATTESTATION_COPY.statements.age}</label>
            <label className="checkbox"><input type="checkbox" checked={form.notBankrupt} onChange={(e) => setForm({ ...form, notBankrupt: e.target.checked })} /> {DIRECTOR_ATTESTATION_COPY.statements.bankruptcy}</label>
            <label className="checkbox"><input type="checkbox" checked={form.notDisqualified} onChange={(e) => setForm({ ...form, notDisqualified: e.target.checked })} /> {DIRECTOR_ATTESTATION_COPY.statements.disqualification}</label>
            <label className="checkbox"><input type="checkbox" checked={form.stillResidentOrEligible} onChange={(e) => setForm({ ...form, stillResidentOrEligible: e.target.checked })} /> {DIRECTOR_ATTESTATION_COPY.statements.residency}</label>
            <Field label="Notes (optional)"><textarea className="textarea" value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}
