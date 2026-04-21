import { useState, useEffect } from "react";
import { useMutation } from "convex/react";
import { FileDown } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Field, LockedField, Badge } from "../components/ui";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { Toggle } from "../components/Controls";
import { useToast } from "../components/Toast";
import { formatDate } from "../lib/format";
import { JURISDICTION_OPTIONS } from "../lib/jurisdictionGuideTracks";

const PRIVACY_PROGRAM_STATUS_OPTIONS = [
  "Unknown",
  "Documented",
  "Needs review",
  "Not started",
].map((value) => ({ value, label: value }));

const MEMBER_DATA_ACCESS_STATUS_OPTIONS = [
  "Unknown",
  "Society-controlled",
  "Partially available",
  "Institution-held",
  "Not applicable",
].map((value) => ({ value, label: value }));

export function SocietyPage() {
  const society = useSociety();
  const toast = useToast();
  const upsert = useMutation(api.society.upsert);
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [importingGovernance, setImportingGovernance] = useState(false);

  useEffect(() => {
    if (society && !form) setForm({ ...society });
  }, [society]);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;
  if (!form) return null;

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const missingGovernanceCount = [
    society.constitutionDocId,
    society.bylawsDocId,
    society.privacyPolicyDocId,
  ].filter((value) => !value).length;

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
        registeredOfficeAddress: form.registeredOfficeAddress,
        mailingAddress: form.mailingAddress,
        purposes: form.purposes,
        privacyOfficerName: form.privacyOfficerName,
        privacyOfficerEmail: form.privacyOfficerEmail,
        privacyProgramStatus: form.privacyProgramStatus,
        privacyProgramReviewedAtISO: form.privacyProgramReviewedAtISO,
        privacyProgramNotes: form.privacyProgramNotes,
        memberDataAccessStatus: form.memberDataAccessStatus,
        memberDataGapDocumented: !!form.memberDataGapDocumented,
        memberDataAccessReviewedAtISO: form.memberDataAccessReviewedAtISO,
        memberDataAccessNotes: form.memberDataAccessNotes,
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
        <div className="card__head">
          <h2 className="card__title">Privacy operations</h2>
          <span className="card__subtitle">Tracks compliance state separately from uploaded evidence.</span>
        </div>
        <div className="card__body">
          <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
            <Field label="Privacy program status" hint="Use Documented when PIPA policies/practices and complaint process have been adopted.">
              <Select
                value={form.privacyProgramStatus ?? ""}
                onChange={(value) => set("privacyProgramStatus", value)}
                clearable
                options={PRIVACY_PROGRAM_STATUS_OPTIONS}
              />
            </Field>
            <Field label="Program reviewed">
              <DatePicker
                value={form.privacyProgramReviewedAtISO ?? ""}
                onChange={(value) => set("privacyProgramReviewedAtISO", value)}
              />
            </Field>
          </div>
          <Field label="Privacy program notes" hint="Examples: complaint process location, access-request procedure, retention schedule, training owner.">
            <textarea
              className="textarea"
              value={form.privacyProgramNotes ?? ""}
              onChange={(e) => set("privacyProgramNotes", e.target.value)}
            />
          </Field>
          <div className="hr" />
          <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
            <Field label="Member data access" hint="Use Institution-held when a university or parent body holds the full member list outside society control.">
              <Select
                value={form.memberDataAccessStatus ?? ""}
                onChange={(value) => set("memberDataAccessStatus", value)}
                clearable
                options={MEMBER_DATA_ACCESS_STATUS_OPTIONS}
              />
            </Field>
            <Field label="Access reviewed">
              <DatePicker
                value={form.memberDataAccessReviewedAtISO ?? ""}
                onChange={(value) => set("memberDataAccessReviewedAtISO", value)}
              />
            </Field>
          </div>
          <Toggle
            checked={!!form.memberDataGapDocumented}
            onChange={(value) => set("memberDataGapDocumented", value)}
            label="Member data-access gap documented"
          />
          <Field label="Member data access notes" hint="Record source requests, refusal/limits, aggregate remittances, direct collection paths, and next review.">
            <textarea
              className="textarea"
              value={form.memberDataAccessNotes ?? ""}
              onChange={(e) => set("memberDataAccessNotes", e.target.value)}
            />
          </Field>
        </div>
      </div>

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
        <div className="card__head">
          <h2 className="card__title">Governance documents</h2>
          <button
            className="btn btn--sm"
            onClick={importGovernanceDocuments}
            disabled={importingGovernance || missingGovernanceCount === 0}
            type="button"
          >
            <FileDown size={12} />
            {importingGovernance ? "Checking…" : "Auto-fill missing"}
          </button>
        </div>
        <div
          className="card__body"
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))", gap: 12 }}
        >
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
    <div className="panel" style={{ padding: 12 }}>
      <div className="row" style={{ gap: 8, marginBottom: 4 }}>
        <Badge tone={present ? "success" : "warn"}>{present ? "On file" : "Missing"}</Badge>
        <strong>{label}</strong>
      </div>
      <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
        {present ? "Linked to documents" : "No linked document"}
      </div>
    </div>
  );
}
