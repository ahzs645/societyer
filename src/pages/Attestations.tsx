import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field, Flag, InspectorNote, RecordChip } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { ShieldCheck, PenLine, Tag } from "lucide-react";
import { formatDate, initials } from "../lib/format";

export function AttestationsPage() {
  const society = useSociety();
  const year = new Date().getFullYear();
  const directors = useQuery(api.directors.list, society ? { societyId: society._id } : "skip");
  const attestations = useQuery(api.attestations.list, society ? { societyId: society._id } : "skip");
  const missing = useQuery(api.attestations.missingForYear, society ? { societyId: society._id, year } : "skip");
  const sign = useMutation(api.attestations.sign);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

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

  // Build table rows: one row per director with their current-year attestation status
  const signedByDirYear = new Map<string, any>();
  (attestations ?? []).forEach((a: any) => {
    signedByDirYear.set(`${a.directorId}-${a.year}`, a);
  });
  const rows = (directors ?? [])
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

  return (
    <div className="page">
      <PageHeader
        title={`Director attestations · ${year}`}
        icon={<ShieldCheck size={16} />}
        iconColor="red"
        subtitle="Annual renewal confirming each director still meets the Societies Act qualifications (age ≥ 18 unless bylaws permit 16–17, not an undischarged bankrupt, not disqualified)."
      />

      {missing && missing.length > 0 && (
        <div className="col" style={{ marginBottom: 16, gap: 6 }}>
          <Flag level="warn">
            {missing.length} director{missing.length === 1 ? "" : "s"} have not yet attested for {year}.
          </Flag>
        </div>
      )}

      <DataTable
        label={`Attestations · ${year}`}
        icon={<ShieldCheck size={14} />}
        data={rows}
        rowKey={(r) => String(r._id)}
        searchPlaceholder="Search directors…"
        defaultSort={{ columnId: "name", dir: "asc" }}
        columns={[
          {
            id: "name", header: "Director", sortable: true,
            accessor: (r) => r.name,
            render: (r) => (
              <RecordChip
                tone="blue"
                avatar={initials(r.director.firstName, r.director.lastName)}
                label={r.name}
              />
            ),
          },
          { id: "position", header: "Position", sortable: true, accessor: (r) => r.position, render: (r) => <span className="cell-tag">{r.position}</span> },
          {
            id: "signed", header: "Status", sortable: true,
            accessor: (r) => (r.signed ? 1 : 0),
            render: (r) =>
              !r.signed ? (
                <Badge tone="warn">Not signed</Badge>
              ) : r.allTrue ? (
                <Badge tone="success">Attested {formatDate(r.signedAtISO)}</Badge>
              ) : (
                <Badge tone="danger">Attested with issues</Badge>
              ),
          },
        ]}
        renderRowActions={(r) => (
          <button className="btn-action btn-action--primary" onClick={() => openSign(String(r._id))}>
            <PenLine size={12} /> {r.signed ? "Re-sign" : "Sign"}
          </button>
        )}
      />

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
              By signing, the director confirms each statement is true as of today and that the
              society can rely on this attestation in its governance records.
            </InspectorNote>
            <label className="checkbox"><input type="checkbox" checked={form.isAtLeast18} onChange={(e) => setForm({ ...form, isAtLeast18: e.target.checked })} /> I am at least 18 years old (or 16–17 and bylaws permit).</label>
            <label className="checkbox"><input type="checkbox" checked={form.notBankrupt} onChange={(e) => setForm({ ...form, notBankrupt: e.target.checked })} /> I am not an undischarged bankrupt.</label>
            <label className="checkbox"><input type="checkbox" checked={form.notDisqualified} onChange={(e) => setForm({ ...form, notDisqualified: e.target.checked })} /> I have not been convicted of an offence that disqualifies me under s.44 of the Societies Act.</label>
            <label className="checkbox"><input type="checkbox" checked={form.stillResidentOrEligible} onChange={(e) => setForm({ ...form, stillResidentOrEligible: e.target.checked })} /> My residency and other eligibility criteria remain accurate.</label>
            <Field label="Notes (optional)"><textarea className="textarea" value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}
