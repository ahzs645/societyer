import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Drawer, Field } from "../components/ui";
import { ScrollText, Plus, Trash2 } from "lucide-react";

type Certificate = {
  _id?: string;
  certificateNumber: string;
  holderName: string;
  shareClass: string;
  shares: number;
  issuedOn: string;
  replacesCertificateNumber?: string;
  cancelledOn?: string;
};

/**
 * Physical share-certificate register. Tracks each issued paper certificate
 * (number, holder, class, shares) with an "as of" date that drives the
 * register's outstanding-by-class summary. Active certificates can be
 * cancelled (setting cancelledOn) or removed; replacement certificates record
 * the number they supersede.
 */
export function CertificateRegisterPage() {
  const society = useSociety();
  const [asOf, setAsOf] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const register = useQuery(
    api.shareCertificates.register,
    society ? { societyId: society._id, asOf } : "skip",
  ) as
    | { active: Array<Certificate>; outstandingByClass: Record<string, number> }
    | undefined;
  const list = useQuery(
    api.shareCertificates.list,
    society ? { societyId: society._id } : "skip",
  ) as Array<Certificate> | undefined;
  const create = useMutation(api.shareCertificates.create);
  const update = useMutation(api.shareCertificates.update);
  const remove = useMutation(api.shareCertificates.remove);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const outstanding = register?.outstandingByClass ?? {};

  const openNew = () => {
    setForm({
      certificateNumber: "",
      holderName: "",
      shareClass: "",
      shares: "",
      issuedOn: new Date().toISOString().slice(0, 10),
      replacesCertificateNumber: "",
    });
    setOpen(true);
  };

  const save = async () => {
    await create({
      societyId: society._id,
      certificateNumber: form.certificateNumber,
      holderName: form.holderName,
      shareClass: form.shareClass,
      shares: Number(form.shares),
      issuedOn: form.issuedOn,
      replacesCertificateNumber: form.replacesCertificateNumber || undefined,
      nowISO: new Date().toISOString(),
    });
    setOpen(false);
  };

  const cancel = async (id?: string) => {
    if (!id) return;
    await update({
      id,
      patch: { cancelledOn: new Date().toISOString().slice(0, 10) },
    });
  };

  const status = (c: Certificate) => {
    if (c.cancelledOn) return `Cancelled ${c.cancelledOn}`;
    if (c.replacesCertificateNumber) return `Replaces ${c.replacesCertificateNumber}`;
    return "Active";
  };

  return (
    <div className="page">
      <PageHeader
        title="Certificate register"
        icon={<ScrollText size={16} />}
        iconColor="purple"
        subtitle="Register of physical share certificates — holder, class, shares and issue date — with outstanding shares by class as of a chosen date."
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>As of</span>
              <input
                type="date"
                className="input"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
              />
            </label>
            <button className="btn-action btn-action--primary" onClick={openNew}>
              <Plus size={12} /> Issue certificate
            </button>
          </div>
        }
      />

      {Object.keys(outstanding).length > 0 && (
        <p style={{ color: "var(--text-secondary)" }}>
          Outstanding by class:{" "}
          {Object.entries(outstanding)
            .map(([cls, shares]) => `${cls} ${shares.toLocaleString()}`)
            .join(" · ")}
        </p>
      )}

      <div className="card">
        {list === undefined ? (
          <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>
        ) : list.length === 0 ? (
          <p style={{ color: "var(--text-tertiary)" }}>No certificates issued yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Certificate #</th>
                <th>Holder</th>
                <th>Class</th>
                <th>Shares</th>
                <th>Issued on</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c._id ?? c.certificateNumber}>
                  <td>{c.certificateNumber}</td>
                  <td>{c.holderName}</td>
                  <td>{c.shareClass}</td>
                  <td>{c.shares.toLocaleString()}</td>
                  <td>{c.issuedOn}</td>
                  <td>{status(c)}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      {!c.cancelledOn && (
                        <button
                          className="btn btn--sm"
                          onClick={() => cancel(c._id)}
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        className="btn btn--ghost btn--sm btn--icon"
                        aria-label={`Delete certificate ${c.certificateNumber}`}
                        onClick={() => remove({ id: c._id })}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Issue certificate"
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn btn--accent" onClick={save}>
              Save
            </button>
          </>
        }
      >
        {form && (
          <div>
            <Field label="Certificate number">
              <input
                className="input"
                value={form.certificateNumber}
                onChange={(e) => setForm({ ...form, certificateNumber: e.target.value })}
              />
            </Field>
            <Field label="Holder name">
              <input
                className="input"
                value={form.holderName}
                onChange={(e) => setForm({ ...form, holderName: e.target.value })}
              />
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Share class">
                <input
                  className="input"
                  value={form.shareClass}
                  onChange={(e) => setForm({ ...form, shareClass: e.target.value })}
                />
              </Field>
              <Field label="Shares">
                <input
                  className="input"
                  type="number"
                  value={form.shares}
                  onChange={(e) => setForm({ ...form, shares: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Issued on">
              <input
                className="input"
                type="date"
                value={form.issuedOn}
                onChange={(e) => setForm({ ...form, issuedOn: e.target.value })}
              />
            </Field>
            <Field label="Replaces certificate number (optional)">
              <input
                className="input"
                value={form.replacesCertificateNumber}
                onChange={(e) =>
                  setForm({ ...form, replacesCertificateNumber: e.target.value })
                }
              />
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

export default CertificateRegisterPage;
