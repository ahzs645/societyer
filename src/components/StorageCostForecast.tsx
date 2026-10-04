import { useState } from "react";
import { Field } from "./ui";
import { Select } from "./Select";
import { forecastR2Cost, type R2ForecastInput } from "../../shared/storage/costForecast";

const fields: Array<{ key: Exclude<keyof R2ForecastInput, "storageClass">; label: string }> = [
  { key: "gbMonths", label: "Storage GB-months including retained versions" },
  { key: "classAOperations", label: "Monthly Class A operations" },
  { key: "classBOperations", label: "Monthly Class B operations" },
  { key: "retrievalGb", label: "Monthly retrieval GB (Infrequent Access)" },
  { key: "additionalMonthlyUsd", label: "Backup, licenses and related services (USD/month)" },
];
const allowanceFields: typeof fields = [
  { key: "remainingFreeGbMonths", label: "Remaining account free GB-months" },
  { key: "remainingFreeClassAOperations", label: "Remaining account free Class A operations" },
  { key: "remainingFreeClassBOperations", label: "Remaining account free Class B operations" },
];

export function StorageCostForecast() {
  const [input, setInput] = useState<R2ForecastInput>({ storageClass: "standard", gbMonths: 0, classAOperations: 0, classBOperations: 0,
    retrievalGb: 0, remainingFreeGbMonths: 0, remainingFreeClassAOperations: 0, remainingFreeClassBOperations: 0, additionalMonthlyUsd: 0 });
  const forecast = forecastR2Cost(input);
  const usd = (value: number) => `$${value.toFixed(2)} USD`;
  return <details>
    <summary>Storage cost forecast</summary>
    <div className="col" style={{ gap: 12, marginTop: 12 }}>
      <p className="muted">Manual R2 scenario using the research report's October 2026 USD prices. Include retained versions and replicas. These inputs are estimates; live usage and invoice reconciliation are unavailable.</p>
      <Field label="Forecast storage class"><Select value={input.storageClass} onChange={(storageClass) => setInput((value) => ({ ...value, storageClass }))} options={[{ value: "standard", label: "R2 Standard" }, { value: "infrequent", label: "R2 Infrequent Access" }]} /></Field>
      <div className="settings-pair">{fields.map(({ key, label }) => <Field key={key} label={label}><input className="input" type="number" min={0} step="any" value={input[key]} onChange={(event) => { const parsed = Number(event.target.value); if (Number.isFinite(parsed) && parsed >= 0) setInput((value) => ({ ...value, [key]: parsed })); }} /></Field>)}</div>
      {input.storageClass === "standard" && <>
        <p className="muted">The free allowance is shared across the provider account. Default zero avoids allocating the same allowance to every workspace. Enter only the remaining share allocated to this scenario.</p>
        <div className="settings-pair">{allowanceFields.map(({ key, label }) => <Field key={key} label={label}><input className="input" type="number" min={0} step="any" value={input[key]} onChange={(event) => { const parsed = Number(event.target.value); if (Number.isFinite(parsed) && parsed >= 0) setInput((value) => ({ ...value, [key]: parsed })); }} /></Field>)}</div>
      </>}
      <div className="notice" role="status"><strong>Estimated monthly total: {usd(forecast.totalUsd)}</strong><div>Storage {usd(forecast.storageUsd)} · Class A {usd(forecast.classAUsd)} · Class B {usd(forecast.classBUsd)} · Retrieval {usd(forecast.retrievalUsd)} · Other {usd(input.additionalMonthlyUsd)}</div></div>
      <p className="muted">Usage rounds up to whole GB-months and whole millions of operations. Infrequent Access has no free tier and a 30-day minimum; enter the billable footprint including that minimum. Taxes, currency conversion and unentered charges are excluded. SharePoint requires a separate quote for the tenant's actual licenses, holds and backup footprint.</p>
      <a href="https://developers.cloudflare.com/r2/pricing/" target="_blank" rel="noreferrer" className="btn-action">Check current R2 prices</a>
    </div>
  </details>;
}
