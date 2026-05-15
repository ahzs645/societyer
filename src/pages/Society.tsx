import { useState, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link, useNavigate } from "react-router-dom";
import { Building2, CheckCircle2, FileDown, MapPin } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { setStoredSocietyId } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Field, LockedField, Badge } from "../components/ui";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { Toggle } from "../components/Controls";
import { useToast } from "../components/Toast";
import { formatDate } from "../lib/format";
import { JURISDICTION_OPTIONS } from "../lib/jurisdictionGuideTracks";
import { optionLabel } from "../lib/orgHubOptions";

const CORE_ONBOARDING_STEPS = [
  "Society profile",
  "Registered locations",
  "Governance documents",
  "People and access",
];

const OPTIONAL_ONBOARDING_STEPS = [
  "Registry verification",
  "Annual compliance calendar",
  "Member register",
  "Finance controls",
  "Privacy and records program",
  "Insurance and risk",
  "Integrations",
  "Board adoption packet",
];

export function SocietyNewPage() {
  const createWorkspace = useMutation(api.society.createWorkspace);
  const actingUserId = useCurrentUserId() ?? undefined;
  const navigate = useNavigate();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    incorporationNumber: "",
    incorporationDate: "",
    fiscalYearEnd: "",
    jurisdictionCode: "CA-BC",
    entityType: "society",
    actFormedUnder: "societies_act",
    officialEmail: "",
    organizationStatus: "active",
    registeredOfficeAddress: "",
    mailingAddress: "",
    purposes: "",
    privacyOfficerName: "",
    privacyOfficerEmail: "",
    isCharity: false,
    isMemberFunded: false,
  });

  const set = (k: string, v: any) => setForm((current) => ({ ...current, [k]: v }));
  const canSave = form.name.trim().length > 0 && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const result = await createWorkspace({ ...form, actingUserId });
      setStoredSocietyId(result.societyId);
      toast.success("Workspace created", `${result.taskIds.length} onboarding tasks created.`);
      navigate(`/app/workflows/${result.workflowId}`);
    } catch (error: any) {
      toast.error("Could not create workspace", error?.message ?? "Check required fields and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="society-create-shell">
      <div className="society-create">
        <aside className="society-create__intro">
          <div className="society-create__brand">
            <div className="society-create__logo"><Building2 size={18} /></div>
            <span>Societyer setup</span>
          </div>
          <div className="society-create__copy">
            <h1>New society workspace</h1>
            <p>
              Start with the society profile. Registry verification and advanced setup stay optional
              until the workspace exists.
            </p>
          </div>
          <div className="society-create__steps" aria-label="Onboarding steps">
            {CORE_ONBOARDING_STEPS.map((step, index) => (
              <div className="society-create__step" key={step}>
                <span className="society-create__step-index">{index + 1}</span>
                <span>{step}</span>
              </div>
            ))}
            <div className="society-create__step society-create__step--optional">
              <CheckCircle2 size={14} />
              <span>Optional setup can be skipped</span>
            </div>
          </div>
        </aside>

        <main className="society-create__main">
          <div className="society-create__topbar">
            <Link className="btn" to="/app/society">Cancel</Link>
            <button className="btn btn--accent" onClick={save} disabled={!canSave}>
              {saving ? "Creating..." : "Create workspace"}
            </button>
          </div>

          <section className="card society-create__card">
            <div className="card__head">
              <div>
                <h2 className="card__title">Society profile</h2>
                <span className="card__subtitle">The only required field right now is the legal name.</span>
              </div>
            </div>
            <div className="card__body">
              <Field label="Legal name">
                <input className="input" value={form.name} onChange={(e) => set("name", e.target.value)} />
              </Field>
              <div className="society-field-grid society-field-grid--three">
                <Field label="Incorporation #">
                  <input className="input" value={form.incorporationNumber} onChange={(e) => set("incorporationNumber", e.target.value)} />
                </Field>
                <Field label="Incorporation date">
                  <DatePicker value={form.incorporationDate} onChange={(v) => set("incorporationDate", v)} />
                </Field>
                <Field label="Fiscal year end" hint="MM-DD">
                  <input className="input" value={form.fiscalYearEnd} onChange={(e) => set("fiscalYearEnd", e.target.value)} placeholder="03-31" />
                </Field>
              </div>
              <div className="society-field-grid">
                <Field label="Legal jurisdiction">
                  <Select value={form.jurisdictionCode} onChange={(v) => set("jurisdictionCode", v)} options={JURISDICTION_OPTIONS} />
                </Field>
                <Field label="Official email">
                  <input className="input" type="email" value={form.officialEmail} onChange={(e) => set("officialEmail", e.target.value)} />
                </Field>
              </div>
              <Field label="Purposes (from constitution)">
                <textarea className="textarea" value={form.purposes} onChange={(e) => set("purposes", e.target.value)} />
              </Field>
              <div className="society-toggle-stack">
                <Toggle checked={form.isCharity} onChange={(v) => set("isCharity", v)} label="Registered CRA charity" />
                <Toggle checked={form.isMemberFunded} onChange={(v) => set("isMemberFunded", v)} label="Member-funded society" />
              </div>
            </div>
          </section>

          <section className="card society-create__card">
            <div className="card__head"><h2 className="card__title">Onboarding flow</h2></div>
            <div className="card__body society-onboarding-flow">
              <div>
                <span className="society-onboarding-flow__eyebrow">Core</span>
                <div className="society-onboarding-flow__list">
                  {CORE_ONBOARDING_STEPS.map((step) => (
                    <span key={step} className="pill pill--sm">{step}</span>
                  ))}
                </div>
              </div>
              <div>
                <span className="society-onboarding-flow__eyebrow">Optional later</span>
                <div className="society-onboarding-flow__list">
                  {OPTIONAL_ONBOARDING_STEPS.map((step) => (
                    <span key={step} className="pill pill--sm pill--gray">{step}</span>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </main>

        <aside className="society-create__side">
          <section className="card society-create__card">
            <div className="card__head"><h2 className="card__title">After profile</h2></div>
            <div className="card__body">
              <p className="muted" style={{ marginTop: 0 }}>
                Societyer will create the workspace, switch you into it, and open an onboarding
                workflow. Registry verification is optional; locations, documents, and people are
                handled as follow-up tasks inside the workspace.
              </p>
              <div className="society-create__next-list">
                <span>Optional registry check</span>
                <span>Registered locations</span>
                <span>Governance documents</span>
                <span>People and access</span>
                <span>Advanced setup checklist</span>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

export function SocietyPage() {
  const society = useSociety();
  const detail = useQuery(api.organizationDetails.overview, society ? { societyId: society._id } : "skip");
  const toast = useToast();
  const upsert = useMutation(api.society.upsert);
  const seedStructuredAddresses = useMutation(api.organizationDetails.seedFromSocietyAddresses);
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [importingGovernance, setImportingGovernance] = useState(false);
  const [seededAddressSocietyId, setSeededAddressSocietyId] = useState<string | null>(null);

  useEffect(() => {
    if (society && !form) setForm({ ...society });
  }, [society]);

  useEffect(() => {
    if (!society || detail === undefined || seededAddressSocietyId === society._id) return;
    setSeededAddressSocietyId(society._id);
    const addresses = detail?.addresses ?? [];
    const hasStructuredRegisteredOffice = addresses.some((row: any) => row.type === "registered_office");
    const hasStructuredMailing = addresses.some((row: any) => row.type === "mailing");
    const hasLegacyAddress = Boolean(society.registeredOfficeAddress || society.mailingAddress);
    if (hasLegacyAddress && (!hasStructuredRegisteredOffice || !hasStructuredMailing)) {
      void seedStructuredAddresses({ societyId: society._id }).catch((error) => {
        console.error("Society address backfill failed", error);
      });
    }
  }, [detail, seededAddressSocietyId, seedStructuredAddresses, society]);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;
  if (!form) return null;

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const missingGovernanceCount = [
    society.constitutionDocId,
    society.bylawsDocId,
    society.privacyPolicyDocId,
  ].filter((value) => !value).length;
  const addresses = detail?.addresses ?? [];
  const currentRegisteredOffice = findCurrentAddress(addresses, "registered_office");
  const currentMailingAddress = findCurrentAddress(addresses, "mailing");
  const registeredOfficeLine = currentRegisteredOffice
    ? addressLine(currentRegisteredOffice)
    : form.registeredOfficeAddress ?? "";
  const mailingAddressLine = currentMailingAddress
    ? addressLine(currentMailingAddress)
    : form.mailingAddress ?? "";

  const save = async () => {
    setSaving(true);
    try {
      await upsert({
        id: form._id,
        name: form.name,
        incorporationNumber: form.incorporationNumber,
        incorporationDate: form.incorporationDate,
        fiscalYearEnd: form.fiscalYearEnd,
        jurisdictionCode: form.jurisdictionCode ?? "CA-BC",
        isCharity: form.isCharity,
        isMemberFunded: form.isMemberFunded,
        registeredOfficeAddress: registeredOfficeLine,
        mailingAddress: mailingAddressLine,
        purposes: form.purposes,
        privacyOfficerName: form.privacyOfficerName,
        privacyOfficerEmail: form.privacyOfficerEmail,
        boardCadence: form.boardCadence,
        boardCadenceDayOfWeek: form.boardCadenceDayOfWeek,
        boardCadenceTime: form.boardCadenceTime,
        boardCadenceNotes: form.boardCadenceNotes,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  };

  const importGovernanceDocuments = async () => {
    setImportingGovernance(true);
    try {
      const response = await fetch("/api/v1/browser-connectors/governance-documents/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          societyId: society._id,
          corpNum: society.incorporationNumber,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? payload?.message ?? `Request failed with ${response.status}`);
      }
      const data = payload.data ?? {};
      const imported = Array.isArray(data.imported) ? data.imported : [];
      const missing = Array.isArray(data.missing) ? data.missing : [];
      if (imported.length) {
        toast.success(
          "Governance documents imported",
          `${imported.length} document${imported.length === 1 ? "" : "s"} linked from BC Registry.`,
        );
      } else if (missing.length) {
        toast.warn(
          "No registry documents imported",
          missing.map((item: any) => item.message ?? item.reason).filter(Boolean).join(" "),
        );
      } else {
        toast.info("Governance documents already on file");
      }
    } catch (error: any) {
      toast.error("Could not import governance documents", error?.message ?? "Open a BC Registry browser session and try again.");
    } finally {
      setImportingGovernance(false);
    }
  };

  return (
    <div className="page page--wide">
      <PageHeader
        routeKey="/app/society"
        title="Society profile"
        subtitle="Constitution details, registered office, and key flags."
        actions={
          <>
            <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
              {saved ? "Saved" : `Last updated ${formatDate(society.updatedAt)}`}
            </span>
            <button className="btn btn--accent" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </>
        }
      />

      <div className="society-layout">
        <main className="society-layout__main">
          <div className="card">
            <div className="card__head"><h2 className="card__title">Identity</h2></div>
            <div className="card__body">
              <LockedField
                label="Legal name"
                reason="Changing the society's legal name requires a special resolution (≥ 2/3 vote) and a name reservation, then filed via Societies Online with the constitution alteration ($50 fee)."
              >
                {(locked) => (
                  <input
                    className="input"
                    disabled={locked}
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                  />
                )}
              </LockedField>

              <div className="society-field-grid society-field-grid--three">
                <LockedField
                  label="Incorporation #"
                  reason="The incorporation number is assigned by the BC Registry and never changes for the life of the society. Edit only to fix a data-entry error."
                >
                  {(locked) => (
                    <input
                      className="input"
                      disabled={locked}
                      value={form.incorporationNumber ?? ""}
                      onChange={(e) => set("incorporationNumber", e.target.value)}
                    />
                  )}
                </LockedField>
                <LockedField
                  label="Incorporation date"
                  reason="The date of incorporation is a historical fact recorded by the BC Registry. Edit only to fix a data-entry error."
                >
                  {(locked) => (
                    <DatePicker
                      disabled={locked}
                      value={form.incorporationDate ?? ""}
                      onChange={(v) => set("incorporationDate", v)}
                    />
                  )}
                </LockedField>
                <LockedField
                  label="Fiscal year end"
                  hint="MM-DD"
                  reason="Changing the fiscal year end can require a bylaw amendment and notification to the CRA. Affects every filing deadline downstream."
                >
                  {(locked) => (
                    <input
                      className="input"
                      disabled={locked}
                      value={form.fiscalYearEnd ?? ""}
                      onChange={(e) => set("fiscalYearEnd", e.target.value)}
                    />
                  )}
                </LockedField>
              </div>

              <LockedField
                label="Purposes (from constitution)"
                reason="The society's purposes are part of the constitution. Changing them requires a special resolution (≥ 2/3 vote) and a constitution alteration filed via Societies Online ($50 fee). Charities must also notify the CRA."
              >
                {(locked) => (
                  <textarea
                    className="textarea"
                    disabled={locked}
                    value={form.purposes ?? ""}
                    onChange={(e) => set("purposes", e.target.value)}
                  />
                )}
              </LockedField>

              <div className="society-field-grid">
                <Field label="Legal jurisdiction" hint="Used for statutory guide tracks and point-in-time legal sources.">
                  <Select
                    value={form.jurisdictionCode ?? "CA-BC"}
                    onChange={(value) => set("jurisdictionCode", value)}
                    options={JURISDICTION_OPTIONS}
                  />
                </Field>

                <LockedField
                  label="Status flags"
                  reason="Charity status is controlled by the CRA (T2050 application / revocation). Member-funded status requires a constitution amendment under s.190 and disqualifies the society from holding land for charitable purposes."
                >
                  {(locked) => (
                    <div className="society-toggle-stack">
                      <Toggle
                        checked={!!form.isCharity}
                        onChange={(v) => set("isCharity", v)}
                        disabled={locked}
                        label="Registered CRA charity"
                      />
                      <Toggle
                        checked={!!form.isMemberFunded}
                        onChange={(v) => set("isMemberFunded", v)}
                        disabled={locked}
                        label="Member-funded society"
                      />
                    </div>
                  )}
                </LockedField>
              </div>
            </div>
          </div>
        </main>

        <aside className="society-layout__side">
          <div className="card">
            <div className="card__head">
              <div className="row" style={{ gap: 8 }}>
                <MapPin size={14} />
                <h2 className="card__title">Registered locations</h2>
                <Badge>{detail === undefined ? "..." : addresses.length}</Badge>
              </div>
              <Link className="btn btn--sm" to="/app/organization-details" style={{ marginLeft: "auto" }}>Manage</Link>
            </div>
            <div className="card__body">
              <div className="society-address-list">
                <AddressSummary
                  label="Registered office"
                  row={currentRegisteredOffice}
                  fallback={form.registeredOfficeAddress}
                  hint="Must be in BC. Records are kept here unless a notice says otherwise."
                />
                <AddressSummary
                  label="Mailing address"
                  row={currentMailingAddress}
                  fallback={form.mailingAddress}
                />
              </div>
              <div className="hr" />
              <div className="society-field-grid society-field-grid--mobile-pair">
                <Field label="Privacy officer (PIPA)">
                  <input className="input" value={form.privacyOfficerName ?? ""} onChange={(e) => set("privacyOfficerName", e.target.value)} />
                </Field>
                <Field label="Privacy officer email">
                  <input className="input" value={form.privacyOfficerEmail ?? ""} onChange={(e) => set("privacyOfficerEmail", e.target.value)} />
                </Field>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Governance documents</h2>
              <button
                className="btn btn--sm"
                onClick={importGovernanceDocuments}
                disabled={importingGovernance || missingGovernanceCount === 0}
                style={{ marginLeft: "auto" }}
                type="button"
              >
                <FileDown size={12} />
                {importingGovernance ? "Checking…" : "Auto-fill missing"}
              </button>
            </div>
            <div className="card__body">
              <div className="table-wrap society-doc-table-wrap">
                <table className="table society-doc-table">
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Status</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    <DocTableRow label="Constitution" present={!!society.constitutionDocId} />
                    <DocTableRow label="Bylaws" present={!!society.bylawsDocId} />
                    <DocTableRow label="PIPA policy" present={!!society.privacyPolicyDocId} />
                    <DocTableRow label="Hyperpolicy" present={false} />
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__head"><h2 className="card__title">Board meeting cadence</h2></div>
            <div className="card__body">
              <div className="society-field-grid society-field-grid--mobile-pair">
                <Field label="Cadence">
                  <Select
                    value={form.boardCadence ?? ""}
                    onChange={(v) => set("boardCadence", v)}
                    clearable
                    options={["Weekly", "Biweekly", "Monthly", "Bimonthly", "Quarterly", "Ad-hoc"].map((c) => ({ value: c, label: c }))}
                  />
                </Field>
                <Field label="Day of week">
                  <Select
                    value={form.boardCadenceDayOfWeek ?? ""}
                    onChange={(v) => set("boardCadenceDayOfWeek", v)}
                    clearable
                    clearLabel="—"
                    options={["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d) => ({ value: d, label: d }))}
                  />
                </Field>
              </div>
              <Field label="Time (24h)">
                <input className="input" type="time" value={form.boardCadenceTime ?? ""} onChange={(e) => set("boardCadenceTime", e.target.value)} />
              </Field>
              <Field label="Notes" hint="e.g. Fourth Thursday of each month, except July & August.">
                <input className="input" value={form.boardCadenceNotes ?? ""} onChange={(e) => set("boardCadenceNotes", e.target.value)} />
              </Field>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function AddressSummary({ label, row, fallback, hint }: { label: string; row?: any; fallback?: string; hint?: string }) {
  const line = row ? addressLine(row) : fallback;
  return (
    <div className="society-address-item">
      <div className="society-address-item__head">
        <strong>{label}</strong>
        {row ? (
          <Badge tone={row.status === "current" ? "success" : "neutral"}>{optionLabel("addressStatuses", row.status)}</Badge>
        ) : fallback ? (
          <Badge tone="warn">Legacy</Badge>
        ) : (
          <Badge>Missing</Badge>
        )}
      </div>
      <div className={line ? "society-address-item__line" : "society-address-item__line muted"}>
        {line || "No address on file"}
      </div>
      {row?.effectiveFrom && (
        <div className="field__hint">Effective {formatDate(row.effectiveFrom)}</div>
      )}
      {hint && <div className="field__hint">{hint}</div>}
    </div>
  );
}

function DocTableRow({ label, present }: { label: string; present: boolean }) {
  return (
    <tr>
      <td>
        <strong>{label}</strong>
      </td>
      <td>
        <Badge tone={present ? "success" : "warn"}>{present ? "On file" : "Missing"}</Badge>
      </td>
      <td className={present ? "table__cell--muted" : undefined}>
        {present ? "—" : "No linked document"}
      </td>
    </tr>
  );
}

function findCurrentAddress(addresses: any[], type: string) {
  return addresses.find((row) => row.type === type && row.status === "current")
    ?? addresses.find((row) => row.type === type);
}

function addressLine(row: any) {
  return [row.unit, row.street, row.city, row.provinceState, row.postalCode, row.country]
    .filter(isAddressPart)
    .join(", ");
}

function isAddressPart(value: unknown) {
  if (!value) return false;
  const text = String(value).trim();
  return Boolean(text) && text.toLowerCase() !== "needs review";
}
