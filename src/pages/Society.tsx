import { useState, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Field, LockedField, Badge } from "../components/ui";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { Toggle } from "../components/Controls";
import { formatDate } from "../lib/format";

export function SocietyPage() {
  const society = useSociety();
  const upsert = useMutation(api.society.upsert);
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (society && !form) setForm({ ...society });
  }, [society]);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;
  if (!form) return null;

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await upsert({
        id: form._id,
        name: form.name,
        incorporationNumber: form.incorporationNumber,
        incorporationDate: form.incorporationDate,
        fiscalYearEnd: form.fiscalYearEnd,
        isCharity: form.isCharity,
        isMemberFunded: form.isMemberFunded,
        registeredOfficeAddress: form.registeredOfficeAddress,
        mailingAddress: form.mailingAddress,
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

  return (
    <div className="page">
      <PageHeader
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

      <div className="two-col">
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

            <div className="row" style={{ gap: 12 }}>
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

            <LockedField
              label="Status flags"
              reason="Charity status is controlled by the CRA (T2050 application / revocation). Member-funded status requires a constitution amendment under s.190 and disqualifies the society from holding land for charitable purposes."
            >
              {(locked) => (
                <div className="row" style={{ gap: 24 }}>
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

        <div className="card">
          <div className="card__head"><h2 className="card__title">Addresses</h2></div>
          <div className="card__body">
            <Field label="Registered office (must be in BC)" hint="Records must be kept here or a notice posted where they are stored.">
              <textarea className="textarea" value={form.registeredOfficeAddress ?? ""} onChange={(e) => set("registeredOfficeAddress", e.target.value)} />
            </Field>
            <Field label="Mailing address">
              <textarea className="textarea" value={form.mailingAddress ?? ""} onChange={(e) => set("mailingAddress", e.target.value)} />
            </Field>
            <div className="hr" />
            <Field label="Privacy officer (PIPA)">
              <input className="input" value={form.privacyOfficerName ?? ""} onChange={(e) => set("privacyOfficerName", e.target.value)} />
            </Field>
            <Field label="Privacy officer email">
              <input className="input" value={form.privacyOfficerEmail ?? ""} onChange={(e) => set("privacyOfficerEmail", e.target.value)} />
            </Field>
          </div>
        </div>
      </div>

      <div className="spacer-6" />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head"><h2 className="card__title">Board meeting cadence</h2>
          <span className="card__subtitle">How often the board meets — used by Timeline and Dashboard.</span>
        </div>
        <div className="card__body">
          <div className="row" style={{ gap: 12 }}>
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
            <Field label="Time (24h)">
              <input className="input" type="time" value={form.boardCadenceTime ?? ""} onChange={(e) => set("boardCadenceTime", e.target.value)} />
            </Field>
          </div>
          <Field label="Notes" hint="e.g. Fourth Thursday of each month, except July & August.">
            <input className="input" value={form.boardCadenceNotes ?? ""} onChange={(e) => set("boardCadenceNotes", e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="card">
        <div className="card__head"><h2 className="card__title">Governance documents</h2></div>
        <div className="card__body row" style={{ gap: 12, flexWrap: "wrap" }}>
          <DocBadge label="Constitution" present={!!society.constitutionDocId} />
          <DocBadge label="Bylaws" present={!!society.bylawsDocId} />
          <DocBadge label="PIPA policy" present={!!society.privacyPolicyDocId} />
        </div>
      </div>
    </div>
  );
}

function DocBadge({ label, present }: { label: string; present: boolean }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      <Badge tone={present ? "success" : "warn"}>{present ? "On file" : "Missing"}</Badge>
      <strong>{label}</strong>
    </div>
  );
}
