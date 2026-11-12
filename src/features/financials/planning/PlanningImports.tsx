import { useState } from "react";
import { useMutation } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "@/lib/convexApi";
import { Field } from "../../../components/ui";
import { Checkbox } from "../../../components/Controls";
import { planningError } from "./planningFormUtils";
import { usePlanningCollection } from "./usePlanningSources";
import { PlanningImportSourcesTable, type ImportSource } from "./PlanningTables";

export function PlanningImports({ societyId, currency, canWrite, onImported }: { societyId: string; currency: string; canWrite: boolean; onImported: () => void }) {
  const [kind, setKind] = useState<"insurance" | "subscription">("insurance"), [selected, setSelected] = useState<ImportSource | null>(null), [confirmed, setConfirmed] = useState(false), [chosenCurrency, setChosenCurrency] = useState(currency), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const sources = usePlanningCollection<ImportSource>({ societyId, collection: kind === "insurance" ? "insurance" : "subscriptions" }, "Cost import sources");
  const importSource = useMutation(api.costPlanning.importSource);
  const open = (source: ImportSource) => { setSelected(source); setConfirmed(false); setChosenCurrency(source.currency ?? currency); setError(""); setMessage(""); };
  const run = async () => { if (!selected || busy || !canWrite) return; setError(""); setBusy(true); try { if (selected.requiresCurrency && !confirmed) throw new Error("Confirm the insurance source currency before importing."); await importSource({ societyId, kind, sourceId: selected._id, ...(selected.requiresCurrency ? { currency: chosenCurrency.trim().toUpperCase() } : {}) }); setMessage(`${selected.name}: linked to one saved planning cost. Existing planning edits are preserved.`); setSelected(null); onImported(); } catch (cause) { setError(planningError(cause)); } finally { setBusy(false); } };
  return <section className="card cost-planner__panel" aria-label="Import existing costs"><h2>Import existing costs</h2><p className="muted">Choose a source explicitly. Importing again reuses its saved planning cost and keeps your edits.</p><div className="cost-planner__actions"><button type="button" className="btn btn--sm" aria-pressed={kind === "insurance"} onClick={() => { setKind("insurance"); setSelected(null); setError(""); }}>Insurance policies</button><button type="button" className="btn btn--sm" aria-pressed={kind === "subscription"} onClick={() => { setKind("subscription"); setSelected(null); setError(""); }}>Subscriptions</button><Link to={kind === "insurance" ? "/app/insurance" : "/app/financials?tab=subscriptions"}>Manage source records</Link></div>
    {sources.loader}{!sources.ready && !sources.error && <p role="status">Loading all {kind === "insurance" ? "insurance policies" : "subscriptions"}…</p>}
    {sources.ready && <PlanningImportSourcesTable kind={kind} sources={sources.rows} canWrite={canWrite} busy={busy} onImport={open} />}
    {selected && <form className="form-stack cost-planner__import-confirm" aria-label="Confirm cost import" onSubmit={(event) => { event.preventDefault(); void run(); }}><h3>Import {selected.name}</h3>{selected.requiresCurrency ? <><Field label="Insurance import currency" hint="The policy has no recorded currency. Confirm the currency of its source amount; no exchange rate is inferred."><input className="input" value={chosenCurrency} maxLength={3} onChange={(event) => { setChosenCurrency(event.target.value.toUpperCase()); setConfirmed(false); }} /></Field><Checkbox label="Confirm insurance currency" checked={confirmed} onChange={setConfirmed} hint={`I confirm this policy amount is in ${chosenCurrency || "the entered currency"}.`} /></> : <p>Source currency: {selected.currency}. Foreign-currency costs remain saved but are excluded from a period in another currency.</p>}<div className="cost-planner__actions"><button type="button" className="btn" disabled={busy} onClick={() => setSelected(null)}>Cancel import</button><button className="btn btn--accent" disabled={busy || !canWrite}>{busy ? "Importing…" : "Import cost"}</button></div></form>}
    {error && <p className="field__error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </section>;
}
