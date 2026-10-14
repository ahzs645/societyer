import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/convexApi";
import { usePermissionedMutation } from "../../hooks/usePermissionedMutation";
import { Drawer, Field, InspectorNote } from "../../components/ui";
import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import { Checkbox } from "../../components/Controls";
import { Money } from "../../components/Money";
import { useToast } from "../../components/Toast";
import { formatDate } from "../../lib/format";
import {
  COMPOUNDING,
  COMPOUNDING_LABEL,
  INVESTMENT_KINDS,
  INVESTMENT_KIND_LABEL,
  accruedInterestCents,
  holdingValueCents,
  isCalendarDate,
  maturityReminders,
} from "../../../shared/businessRegisters";
import { centsToInput, FieldRow, inputToCents, MoneyField } from "./formHelpers";
import type { HoldingRow } from "./types";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.replace(/^.*Uncaught Error:\s*/, "").split("\n")[0] : "Something went wrong.";
}

export function HoldingDrawer({
  open,
  onClose,
  societyId,
  holding,
  funds,
  canWrite,
  today,
}: {
  open: boolean;
  onClose: () => void;
  societyId: string;
  holding: HoldingRow | null;
  funds: Array<{ _id: string; name: string }>;
  canWrite: boolean;
  today: string;
}) {
  const toast = useToast();
  const save = usePermissionedMutation(api.investments.upsert, canWrite);
  const remove = usePermissionedMutation(api.investments.remove, canWrite);
  const [form, setForm] = useState<Record<string, string>>({});
  const [restricted, setRestricted] = useState(false);
  const [autoRenew, setAutoRenew] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm({
      name: holding?.name ?? "",
      kind: holding?.kind ?? "gic",
      institution: holding?.institution ?? "",
      accountLast4: holding?.accountLast4 ?? "",
      principal: centsToInput(holding?.principalCents),
      rate: holding?.ratePercent !== undefined ? String(holding.ratePercent) : "",
      compounding: holding?.compounding ?? "simple",
      startDate: holding?.startDate ?? today,
      maturityDate: holding?.maturityDate ?? "",
      interestPaid: centsToInput(holding?.interestPaidCents),
      currentValue: centsToInput(holding?.currentValueCents),
      fundRestrictionId: holding?.fundRestrictionId ?? "",
      status: holding?.status ?? "active",
      redeemedOn: holding?.redeemedOn ?? "",
      notes: holding?.notes ?? "",
    });
    setRestricted(holding?.restricted ?? false);
    setAutoRenew(holding?.autoRenew ?? false);
  }, [open, holding, today]);

  const preview = useMemo(() => {
    const principalCents = inputToCents(form.principal) ?? 0;
    if (!principalCents || !isCalendarDate(form.startDate)) return null;
    const draft = {
      principalCents,
      ratePercent: form.rate ? Number(form.rate) : undefined,
      compounding: form.compounding,
      startDate: form.startDate,
      maturityDate: form.maturityDate || undefined,
      interestPaidCents: inputToCents(form.interestPaid),
      currentValueCents: inputToCents(form.currentValue),
      status: form.status,
    };
    return { accrued: accruedInterestCents(draft, today), value: holdingValueCents(draft, today) };
  }, [form, today]);
  const reminders = form.status === "redeemed" ? [] : maturityReminders(form.maturityDate || undefined).filter((item) => item.date >= today);
  const hasTerm = form.kind === "gic" || form.kind === "term_deposit";

  const submit = async () => {
    setBusy(true);
    try {
      await save({
        ...(holding ? { id: holding._id } : {}),
        societyId,
        name: form.name,
        kind: form.kind,
        institution: form.institution,
        accountLast4: form.accountLast4 || undefined,
        principalCents: inputToCents(form.principal) ?? 0,
        ratePercent: form.rate ? Number(form.rate) : undefined,
        compounding: form.rate ? form.compounding : undefined,
        startDate: form.startDate,
        maturityDate: form.maturityDate || undefined,
        interestPaidCents: inputToCents(form.interestPaid),
        currentValueCents: form.kind === "investment_account" ? inputToCents(form.currentValue) : undefined,
        restricted: restricted || Boolean(form.fundRestrictionId),
        fundRestrictionId: form.fundRestrictionId || undefined,
        autoRenew: hasTerm ? autoRenew : undefined,
        status: form.status,
        redeemedOn: form.status === "redeemed" ? form.redeemedOn || undefined : undefined,
        notes: form.notes || undefined,
      });
      toast.success(holding ? "Holding saved" : "Holding added", form.maturityDate && form.status !== "redeemed" ? "Maturity reminders are on the Deadlines page." : undefined);
      onClose();
    } catch (error) {
      toast.error("Couldn't save the holding", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const del = async () => {
    if (!holding) return;
    setBusy(true);
    try {
      await remove({ id: holding._id });
      toast.success("Holding removed");
      onClose();
    } catch (error) {
      toast.error("Couldn't remove the holding", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={holding ? holding.name : "New holding"}
      footer={
        <>
          {holding && canWrite && <button className="btn btn--ghost btn--danger-text" onClick={del} disabled={busy}>Remove</button>}
          <span className="register-drawer__spacer" />
          <button className="btn" onClick={onClose}>{canWrite ? "Cancel" : "Close"}</button>
          {canWrite && <button className="btn btn--accent" onClick={submit} disabled={busy}>Save</button>}
        </>
      }
    >
      {preview && (
        <dl className="register-summary">
          <div><dt>Accrued interest</dt><dd><Money cents={preview.accrued} /></dd></div>
          <div><dt>Value today</dt><dd><Money cents={preview.value} /></dd></div>
          <div><dt>Matures</dt><dd>{form.maturityDate ? formatDate(form.maturityDate) : "No term"}</dd></div>
        </dl>
      )}
      <Field label="Name" required hint={'e.g. "Operating reserve GIC"'}><input className="input" value={form.name ?? ""} onChange={(event) => setForm({ ...form, name: event.target.value })} disabled={!canWrite} /></Field>
      <FieldRow>
        <Field label="Type">
          <Select value={form.kind ?? "gic"} onChange={(kind) => setForm({ ...form, kind })} options={INVESTMENT_KINDS.map((value) => ({ value, label: INVESTMENT_KIND_LABEL[value] }))} disabled={!canWrite} />
        </Field>
        <Field label="Institution" required><input className="input" value={form.institution ?? ""} onChange={(event) => setForm({ ...form, institution: event.target.value })} disabled={!canWrite} /></Field>
        <Field label="Account, last 4"><input className="input input--last4" inputMode="numeric" maxLength={4} value={form.accountLast4 ?? ""} onChange={(event) => setForm({ ...form, accountLast4: event.target.value.replace(/\D/g, "").slice(0, 4) })} disabled={!canWrite} /></Field>
      </FieldRow>
      <FieldRow>
        <MoneyField label="Principal" required value={form.principal ?? ""} onChange={(principal) => setForm({ ...form, principal })} disabled={!canWrite} />
        <Field label="Rate (% a year)"><input className="input" inputMode="decimal" value={form.rate ?? ""} onChange={(event) => setForm({ ...form, rate: event.target.value.replace(/[^\d.]/g, "") })} disabled={!canWrite} /></Field>
        {form.rate && (
          <Field label="Interest">
            <Select value={form.compounding ?? "simple"} onChange={(compounding) => setForm({ ...form, compounding })} options={COMPOUNDING.map((value) => ({ value, label: COMPOUNDING_LABEL[value] }))} disabled={!canWrite} />
          </Field>
        )}
      </FieldRow>
      <FieldRow>
        <Field label="Start" required><DatePicker value={form.startDate ?? ""} onChange={(startDate) => setForm({ ...form, startDate })} disabled={!canWrite} /></Field>
        <Field label="Matures" required={hasTerm}><DatePicker value={form.maturityDate ?? ""} onChange={(maturityDate) => setForm({ ...form, maturityDate })} disabled={!canWrite} /></Field>
      </FieldRow>
      {reminders.length > 0 && (
        <p className="register-hint">Reminders on the Deadlines page: {reminders.map((item) => `${formatDate(item.date)} (${item.daysBefore} days before)`).join(" and ")}.</p>
      )}
      <FieldRow>
        <MoneyField label="Interest paid out" value={form.interestPaid ?? ""} onChange={(interestPaid) => setForm({ ...form, interestPaid })} disabled={!canWrite} hint="So far. Accrued interest is what's earned on top." />
        {form.kind === "investment_account" && <MoneyField label="Market value" value={form.currentValue ?? ""} onChange={(currentValue) => setForm({ ...form, currentValue })} disabled={!canWrite} hint="From the latest statement." />}
      </FieldRow>
      {hasTerm && <Checkbox checked={autoRenew} onChange={setAutoRenew} label="Renews automatically at maturity" disabled={!canWrite} />}
      <section className="register-section">
        <h3 className="register-section__title">Restrictions</h3>
        {funds.length > 0 && (
          <Field label="Restricted fund">
            <Select value={form.fundRestrictionId ?? ""} onChange={(fundRestrictionId) => setForm({ ...form, fundRestrictionId })} options={funds.map((fund) => ({ value: fund._id, label: fund.name }))} clearable clearLabel="None" disabled={!canWrite} />
          </Field>
        )}
        {!form.fundRestrictionId && <Checkbox checked={restricted} onChange={setRestricted} label="Held for a restricted purpose" hint="Restricted holdings are kept apart from unrestricted reserves." disabled={!canWrite} />}
      </section>
      <FieldRow>
        <Field label="Status">
          <Select value={form.status ?? "active"} onChange={(status) => setForm({ ...form, status })} options={[{ value: "active", label: "Held" }, { value: "redeemed", label: "Redeemed" }]} disabled={!canWrite} />
        </Field>
        {form.status === "redeemed" && <Field label="Redeemed on"><DatePicker value={form.redeemedOn ?? ""} onChange={(redeemedOn) => setForm({ ...form, redeemedOn })} disabled={!canWrite} /></Field>}
      </FieldRow>
      <Field label="Notes"><textarea className="textarea" rows={2} value={form.notes ?? ""} onChange={(event) => setForm({ ...form, notes: event.target.value })} disabled={!canWrite} /></Field>
      <InspectorNote title="Records only">
        Buy, renew and redeem with the institution. Record the result here so reserves and reminders stay right.
      </InspectorNote>
    </Drawer>
  );
}
