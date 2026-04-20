import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Field, Flag } from "../components/ui";
import { formatDate, formatDateTime, money } from "../lib/format";
import { isDemoMode } from "../lib/demoMode";
import { Braces, Database, ExternalLink, Link2, PiggyBank, PlusCircle, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useToast } from "../components/Toast";

export function FinancialsPage() {
  const society = useSociety();
  const items = useQuery(api.financials.list, society ? { societyId: society._id } : "skip");
  const orgHistory = useQuery(api.organizationHistory.list, society ? { societyId: society._id } : "skip");
  const connections = useQuery(
    api.financialHub.connections,
    society ? { societyId: society._id } : "skip",
  );
  const hub = useQuery(
    api.financialHub.summary,
    society ? { societyId: society._id } : "skip",
  );
  const accounts = useQuery(
    api.financialHub.accounts,
    society ? { societyId: society._id } : "skip",
  );
  const transactions = useQuery(
    api.financialHub.transactions,
    society ? { societyId: society._id, limit: 25 } : "skip",
  );
  const oauth = useQuery(
    api.financialHub.oauthUrl,
    society ? { societyId: society._id } : "skip",
  );
  const markConnected = useMutation(api.financialHub.markConnectionConnected);
  const disconnect = useMutation(api.financialHub.disconnect);
  const sync = useAction(api.financialHub.sync);
  const syncWaveCache = useAction(api.waveCache.sync);
  const checkWaveHealth = useAction(api.waveCache.healthCheck);
  const waveSummary = useQuery(
    api.waveCache.summary,
    society ? { societyId: society._id } : "skip",
  );
  const upsertBudget = useMutation(api.financialHub.upsertBudget);
  const removeBudget = useMutation(api.financialHub.removeBudget);
  const actingUserId = useCurrentUserId() ?? undefined;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [waveHealthBusy, setWaveHealthBusy] = useState(false);
  const [waveHealth, setWaveHealth] = useState<any>(null);
  const [budgetForm, setBudgetForm] = useState<{ category: string; planned: string } | null>(null);
  const [waveMode, setWaveMode] = useState<"resources" | "structures">("resources");
  const [waveResourceType, setWaveResourceType] = useState("account");
  const [waveSearch, setWaveSearch] = useState("");
  const [selectedWaveResourceId, setSelectedWaveResourceId] = useState<string | null>(null);
  const waveResources = useQuery(
    api.waveCache.resources,
    society
      ? {
          societyId: society._id,
          resourceType: waveResourceType === "all" ? undefined : waveResourceType,
          search: waveSearch || undefined,
          limit: 500,
        }
      : "skip",
  );
  const waveStructures = useQuery(
    api.waveCache.structures,
    society ? { societyId: society._id, search: waveSearch || undefined, limit: 100 } : "skip",
  );
  const selectedWaveResource = useQuery(
    api.waveCache.resource,
    selectedWaveResourceId ? { id: selectedWaveResourceId as any } : "skip",
  );

  const sorted = (items ?? []).slice().sort((a, b) => b.fiscalYear.localeCompare(a.fiscalYear));
  const latest = sorted[0];
  const fiscalYear = latest?.fiscalYear ?? new Date().getFullYear().toString();
  const activeConnection = (connections ?? []).find((c) => c.status === "connected");
  const importedBudgetCount = (orgHistory?.budgets ?? []).length;
  const waveLive = oauth?.live === true;
  const waveDemoAvailable = !waveLive && isDemoMode() && oauth?.demoAvailable === true;
  const canConnectWave = waveLive || waveDemoAvailable;
  const waveResourceTypes = useMemo(() => {
    const counts = waveSummary?.resourceCounts ?? {};
    const ordered = ["account", "vendor", "product", "customer", "invoice", "estimate", "salesTax", "business", "availableBusiness"];
    const types = ordered.filter((type) => counts[type] != null);
    for (const type of Object.keys(counts)) {
      if (!types.includes(type)) types.push(type);
    }
    return types;
  }, [waveSummary]);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const connect = async () => {
    if (!society) return;
    if (!canConnectWave) {
      toast.warn("Wave credentials are not configured for this workspace.");
      return;
    }
    setBusy(true);
    try {
      const demo = !waveLive && waveDemoAvailable;
      const connectionId = await markConnected({
        societyId: society._id,
        provider: "wave",
        accountLabel: demo ? "Riverside demo book" : "Connected Wave book",
        externalBusinessId: demo ? "biz_demo_01" : undefined,
        demo,
        actingUserId,
      });
      await sync({ connectionId });
      toast.success(demo ? "Connected to demo Wave workspace" : "Connected to Wave");
    } catch (err: any) {
      toast.error(err?.message ?? "Connect failed");
    } finally {
      setBusy(false);
    }
  };

  const refreshWaveCache = async () => {
    if (!society) return;
    setBusy(true);
    try {
      const result = await syncWaveCache({
        societyId: society._id,
        connectionId: activeConnection?._id,
      });
      toast.success(
        `Cached ${result.resourceCount} Wave resources and ${result.structureCount} structures.`,
      );
    } catch (err: any) {
      toast.error(err?.message ?? "Wave cache refresh failed");
    } finally {
      setBusy(false);
    }
  };

  const runWaveHealthCheck = async () => {
    if (!society) return;
    setWaveHealthBusy(true);
    try {
      const result = redactWaveHealthResult(await checkWaveHealth({
        businessId: activeConnection?.externalBusinessId,
      }));
      setWaveHealth(result);
      if (result.ok) {
        toast.success("Wave health check passed");
      } else {
        const failingStep = result.steps?.find((step: any) => step.status === "fail");
        toast.warn("Wave health check needs attention", failingStep?.message ?? "Review the Wave diagnostics.");
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Wave health check failed");
    } finally {
      setWaveHealthBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Financials"
        icon={<PiggyBank size={16} />}
        iconColor="green"
        subtitle="Connected bank balances, budget vs actuals, restricted funds, and the AGM financial statements. Disclose remuneration ≥ $75k (s.36)."
        actions={
          activeConnection ? (
            <>
              <Badge tone="success">Connected · {activeConnection.provider}</Badge>
              <button
                className="btn-action"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const result = await sync({ connectionId: activeConnection._id });
                    toast.success(
                      `Synced ${result.accounts} accounts, ${result.transactions} transactions.`,
                    );
                  } catch (err: any) {
                    toast.error(err?.message ?? "Sync failed");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <RefreshCw size={12} /> Sync
              </button>
              <button
                className="btn-action"
                disabled={busy}
                onClick={refreshWaveCache}
              >
                <Database size={12} /> Cache
              </button>
              <button
                className="btn-action"
                disabled={busy || waveHealthBusy}
                onClick={runWaveHealthCheck}
              >
                <ShieldCheck size={12} /> Check
              </button>
              <button
                className="btn-action"
                onClick={async () => {
                  await disconnect({ connectionId: activeConnection._id, actingUserId });
                  toast.info("Disconnected Wave");
                }}
              >
                Disconnect
              </button>
            </>
          ) : (
            <>
              <button
                className="btn-action btn-action--primary"
                disabled={busy || !canConnectWave}
                onClick={connect}
                title={!canConnectWave ? "Configure Wave credentials before connecting this workspace." : undefined}
              >
                <Link2 size={12} /> Connect Wave
              </button>
              <button
                className="btn-action"
                disabled={busy || waveHealthBusy}
                onClick={runWaveHealthCheck}
              >
                <ShieldCheck size={12} /> Check
              </button>
            </>
          )
        }
      />

      {!activeConnection && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__head">
            <h2 className="card__title">Connect a bookkeeping source</h2>
            <span className="card__subtitle">
              Pull balances, transactions and restricted-fund splits from Wave.{" "}
              {oauth?.live ? (
                <>Live mode — sync uses configured Wave API credentials.</>
              ) : waveDemoAvailable ? (
                <>Demo mode — connecting seeds a fictional book so the dashboard lights up.</>
              ) : (
                <>Wave credentials are not configured, so this workspace will not receive demo financial data.</>
              )}
            </span>
          </div>
          <div className="card__body" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <ProviderCard
              name="Wave"
              desc="Free bookkeeping, REST + GraphQL API."
              status={waveLive ? "live" : waveDemoAvailable ? "demo" : "setup"}
              onConnect={canConnectWave ? connect : undefined}
              busy={busy}
            />
            <ProviderCard name="QuickBooks" desc="Coming soon — OAuth flow planned." status="planned" />
            <ProviderCard name="Xero" desc="Coming soon — for multi-currency orgs." status="planned" />
          </div>
        </div>
      )}

      {waveHealth && <WaveHealthPanel result={waveHealth} />}

      {activeConnection && hub && (
        <div className="stat-grid" style={{ marginBottom: 16 }}>
          <Stat label="Total bank balance" value={money(hub.totalBalance)} />
          <Stat label="Unrestricted" value={money(hub.unrestricted)} tone={hub.unrestricted < 0 ? "danger" : "ok"} />
          <Stat label="Restricted funds" value={money(hub.totalBalance - hub.unrestricted)} />
          <Stat
            label="Last sync"
            value={activeConnection.lastSyncAtISO ? formatDateTime(activeConnection.lastSyncAtISO) : "—"}
          />
        </div>
      )}

      {activeConnection && (
        <WaveCacheExplorer
          busy={busy}
          mode={waveMode}
          onModeChange={setWaveMode}
          onRefresh={refreshWaveCache}
          resources={waveResources ?? []}
          resourceType={waveResourceType}
          resourceTypes={waveResourceTypes}
          search={waveSearch}
          selectedResource={selectedWaveResource}
          selectedResourceId={selectedWaveResourceId}
          structures={waveStructures ?? []}
          summary={waveSummary}
          onResourceTypeChange={(type) => {
            setWaveResourceType(type);
            setSelectedWaveResourceId(null);
          }}
          onSearchChange={setWaveSearch}
          onSelectResource={(id) => setSelectedWaveResourceId(id)}
        />
      )}

      {activeConnection && hub && hub.restrictedAccounts.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__head">
            <h2 className="card__title">Restricted funds</h2>
            <span className="card__subtitle">Earmarked for specific purposes — track separately (CPA guidance).</span>
          </div>
          <table className="table">
            <thead>
              <tr><th>Fund</th><th>Purpose</th><th style={{ textAlign: "right" }}>Balance</th></tr>
            </thead>
            <tbody>
              {hub.restrictedAccounts.map((a, i) => (
                <tr key={i}>
                  <td>{a.name}</td>
                  <td className="muted" style={{ fontSize: 13 }}>{a.purpose ?? "—"}</td>
                  <td className="table__cell--mono" style={{ textAlign: "right" }}>{money(a.balanceCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeConnection && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__head">
            <h2 className="card__title">Budget vs actuals — FY {fiscalYear}</h2>
            <span className="card__subtitle">Plan a category, actuals come from synced transactions.</span>
            <div style={{ marginLeft: "auto" }}>
              <button
                className="btn-action"
                onClick={() => setBudgetForm({ category: "", planned: "" })}
              >
                <PlusCircle size={12} /> Add budget line
              </button>
            </div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Category</th>
                <th style={{ textAlign: "right" }}>Planned</th>
                <th style={{ textAlign: "right" }}>Actual</th>
                <th style={{ textAlign: "right" }}>Variance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(hub?.budgetRows ?? []).map((b: any) => {
                const variance = b.plannedCents - b.actualCents;
                return (
                  <tr key={b._id}>
                    <td>{b.category}</td>
                    <td className="table__cell--mono" style={{ textAlign: "right" }}>{money(b.plannedCents)}</td>
                    <td className="table__cell--mono" style={{ textAlign: "right" }}>{money(b.actualCents)}</td>
                    <td
                      className="table__cell--mono"
                      style={{ textAlign: "right", color: variance < 0 ? "var(--danger)" : "var(--success)" }}
                    >
                      {money(variance)}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="btn btn--ghost btn--sm btn--icon"
                        aria-label={`Delete budget ${b.name}`}
                        onClick={() => removeBudget({ id: b._id, actingUserId })}
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {(hub?.budgetRows ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="muted" style={{ textAlign: "center", padding: 16 }}>
                    No budget lines yet. Add a category to start tracking variance.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {budgetForm && (
            <div className="card__body" style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <Field label="Category">
                <input
                  className="input"
                  value={budgetForm.category}
                  onChange={(e) => setBudgetForm({ ...budgetForm, category: e.target.value })}
                  placeholder="e.g. Program supplies"
                />
              </Field>
              <Field label="Planned (CAD)">
                <input
                  className="input"
                  type="number"
                  value={budgetForm.planned}
                  onChange={(e) => setBudgetForm({ ...budgetForm, planned: e.target.value })}
                  placeholder="12000"
                />
              </Field>
              <button
                className="btn btn--accent"
                onClick={async () => {
                  if (!budgetForm.category || !budgetForm.planned) return;
                  await upsertBudget({
                    societyId: society._id,
                    fiscalYear,
                    category: budgetForm.category,
                    plannedCents: Math.round(Number(budgetForm.planned) * 100),
                    actingUserId,
                  });
                  setBudgetForm(null);
                  toast.success("Budget saved");
                }}
              >
                Save
              </button>
              <button className="btn" onClick={() => setBudgetForm(null)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {activeConnection && transactions && transactions.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__head">
            <h2 className="card__title">Recent transactions</h2>
            <span className="card__subtitle">Latest activity from the connected source.</span>
          </div>
          <table className="table">
            <thead>
              <tr><th>Date</th><th>Description</th><th>Account</th><th>Category</th><th style={{ textAlign: "right" }}>Amount</th></tr>
            </thead>
            <tbody>
              {transactions.map((t) => {
                const acct = (accounts ?? []).find((a) => a._id === t.accountId);
                return (
                  <tr key={t._id}>
                    <td className="table__cell--mono">{t.date}</td>
                    <td>{t.description}</td>
                    <td className="muted">{acct?.name ?? "—"}</td>
                    <td><Badge>{t.category ?? "uncategorized"}</Badge></td>
                    <td
                      className="table__cell--mono"
                      style={{ textAlign: "right", color: t.amountCents < 0 ? "var(--danger)" : "var(--success)" }}
                    >
                      {money(t.amountCents)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {importedBudgetCount > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Flag level="warn">
            <strong>{importedBudgetCount} imported budget snapshot{importedBudgetCount === 1 ? "" : "s"}</strong>{" "}
            awaiting review before use as official statements.{" "}
            <Link to="/app/org-history?section=budgets">Review in history →</Link>
          </Flag>
        </div>
      )}

      {latest && (
        <div className="stat-grid">
          <Stat label={`FY ${latest.fiscalYear} revenue`} value={money(latest.revenueCents)} />
          <Stat label="Expenses" value={money(latest.expensesCents)} />
          <Stat
            label="Net surplus / (deficit)"
            value={money(latest.revenueCents - latest.expensesCents)}
            tone={latest.revenueCents - latest.expensesCents >= 0 ? "ok" : "danger"}
          />
          <Stat label="Net assets" value={money(latest.netAssetsCents)} />
        </div>
      )}

      <div className="card">
        <div className="card__head"><h2 className="card__title">Year-over-year</h2></div>
        <table className="table">
          <thead>
            <tr>
              <th>Fiscal year</th>
              <th>Period end</th>
              <th>Revenue</th>
              <th>Expenses</th>
              <th>Net assets</th>
              <th>Restricted</th>
              <th>Audit</th>
              <th>Board approval</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((f) => (
              <tr key={f._id}>
                <td><strong>{f.fiscalYear}</strong></td>
                <td className="table__cell--mono">{formatDate(f.periodEnd)}</td>
                <td className="table__cell--mono">{money(f.revenueCents)}</td>
                <td className="table__cell--mono">{money(f.expensesCents)}</td>
                <td className="table__cell--mono">{money(f.netAssetsCents)}</td>
                <td className="table__cell--mono">{money(f.restrictedFundsCents)}</td>
                <td>
                  <Badge tone={f.auditStatus === "Audited" ? "success" : f.auditStatus === "ReviewEngagement" ? "info" : "warn"}>
                    {f.auditStatus}
                  </Badge>
                  {f.auditorName && <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{f.auditorName}</div>}
                </td>
                <td className="table__cell--mono">{f.approvedByBoardAt ? formatDate(f.approvedByBoardAt) : "—"}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: 24 }}>No financial statements yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {latest && latest.remunerationDisclosures.length > 0 && (
        <>
          <div className="spacer-6" />
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Remuneration disclosure — FY {latest.fiscalYear}</h2>
              <span className="card__subtitle">Top employees/contractors paid ≥ $75,000 (s.36 Societies Act).</span>
            </div>
            <table className="table">
              <thead>
                <tr><th>Position</th><th style={{ textAlign: "right" }}>Total compensation</th></tr>
              </thead>
              <tbody>
                {latest.remunerationDisclosures.map((r, i) => (
                  <tr key={i}>
                    <td>{r.role}</td>
                    <td className="table__cell--mono" style={{ textAlign: "right" }}>{money(r.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "danger" }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value" style={{ color: tone === "danger" ? "var(--danger)" : undefined }}>{value}</div>
    </div>
  );
}

function WaveHealthPanel({ result }: { result: any }) {
  const envRows = result.env ?? [];
  const steps = result.steps ?? [];
  const checkedAt = result.checkedAtISO ? formatDateTime(result.checkedAtISO) : "just now";

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card__head">
        <h2 className="card__title">Wave connection health</h2>
        <Badge tone={healthTone(result.status)}>
          {healthLabel(result.status)}
        </Badge>
        <span className="card__subtitle">
          {checkedAt} · {result.mode === "live" ? "live" : "not configured"} · secrets redacted
        </span>
      </div>
      <div
        className="card__body"
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        }}
      >
        <div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Expected environment</div>
          <div style={{ display: "grid", gap: 8 }}>
            {envRows.map((row: any) => (
              <div key={row.name} style={{ display: "grid", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <code className="mono">{row.name}</code>
                  <Badge tone={row.present ? "success" : row.required ? "danger" : "neutral"}>
                    {row.present ? "present" : "missing"}
                  </Badge>
                  {row.required && <Badge tone="warn">required</Badge>}
                  {row.secret && <Badge tone="info">secret</Badge>}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>{redactCredentialText(row.purpose)}</div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Probe result</div>
          {result.business && (
            <div style={{ marginBottom: 10 }}>
              <strong>{redactCredentialText(result.business.name ?? "Selected business")}</strong>
              {result.business.currencyCode && <span className="muted"> · {redactCredentialText(result.business.currencyCode)}</span>}
              <div className="muted" style={{ fontSize: 12 }}>Business source: {businessSourceLabel(result.business.source)}</div>
            </div>
          )}
          <div style={{ display: "grid", gap: 8 }}>
            {steps.map((step: any) => (
              <div key={step.id} style={{ display: "grid", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <Badge tone={healthTone(step.status)}>{healthLabel(step.status)}</Badge>
                  <strong>{step.label}</strong>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>{redactCredentialText(step.message)}</div>
                {step.detail && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {Object.entries(step.detail).map(([key, value]) => (
                      <span key={key} className="cell-tag">{redactCredentialText(key)}: {formatWaveHealthDetail(value)}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function redactWaveHealthResult(result: any) {
  return {
    ...result,
    business: result?.business
      ? {
          ...result.business,
          name: result.business.name ? redactCredentialText(result.business.name) : result.business.name,
          currencyCode: result.business.currencyCode ? redactCredentialText(result.business.currencyCode) : result.business.currencyCode,
        }
      : result?.business,
    steps: (result?.steps ?? []).map((step: any) => ({
      ...step,
      label: redactCredentialText(step.label),
      message: redactCredentialText(step.message),
      detail: step.detail ? redactWaveHealthDetail(step.detail) : step.detail,
    })),
  };
}

function redactWaveHealthDetail(detail: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(detail).map(([key, value]) => [
      redactCredentialText(key),
      typeof value === "string" ? redactCredentialText(value) : value,
    ]),
  );
}

function formatWaveHealthDetail(value: unknown) {
  return typeof value === "string" ? redactCredentialText(value) : String(value);
}

function redactCredentialText(value: unknown) {
  return String(value ?? "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/(Authorization\s*:\s*)[^\s,;")]+/gi, "$1[redacted]")
    .replace(/\b(access[_-]?token|refresh[_-]?token|client[_-]?(?:id|secret)|authorization|code)=([^&\s]+)/gi, "$1=[redacted]")
    .replace(/(["']?(?:access[_-]?token|refresh[_-]?token|client[_-]?(?:id|secret)|authorization|api[_-]?key|token|secret|code)["']?\s*[:=]\s*["']?)([^"',}\s;]+)/gi, "$1[redacted]")
    .replace(/\bwave_[A-Za-z0-9._~-]{4,}\b/g, "wave_[redacted]")
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted-token]");
}

function healthTone(status?: string): "success" | "warn" | "danger" | "neutral" {
  if (status === "pass") return "success";
  if (status === "warn") return "warn";
  if (status === "fail") return "danger";
  return "neutral";
}

function healthLabel(status?: string) {
  if (status === "pass") return "pass";
  if (status === "warn") return "warning";
  if (status === "fail") return "fail";
  return "skipped";
}

function businessSourceLabel(source?: string) {
  if (source === "env") return "WAVE_BUSINESS_ID";
  if (source === "argument") return "connection";
  if (source === "firstAccessible") return "first accessible business";
  return "unknown";
}

function WaveCacheExplorer({
  busy,
  mode,
  onModeChange,
  onRefresh,
  resources,
  resourceType,
  resourceTypes,
  search,
  selectedResource,
  selectedResourceId,
  structures,
  summary,
  onResourceTypeChange,
  onSearchChange,
  onSelectResource,
}: {
  busy: boolean;
  mode: "resources" | "structures";
  onModeChange: (mode: "resources" | "structures") => void;
  onRefresh: () => void;
  resources: any[];
  resourceType: string;
  resourceTypes: string[];
  search: string;
  selectedResource: any;
  selectedResourceId: string | null;
  structures: any[];
  summary: any;
  onResourceTypeChange: (type: string) => void;
  onSearchChange: (value: string) => void;
  onSelectResource: (id: string) => void;
}) {
  const counts = summary?.resourceCounts ?? {};
  const totalResources = Object.values(counts).reduce((sum: number, value: any) => sum + Number(value ?? 0), 0);
  const selectedRaw = selectedResource?.raw
    ? JSON.stringify(selectedResource.raw, null, 2)
    : selectedResourceId
    ? "Loading..."
    : "";

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card__head">
        <h2 className="card__title">Wave data cache</h2>
        <span className="card__subtitle">
          {summary ? (
            <>
              {summary.businessName} · {totalResources} resources · {summary.structureTypes?.length ?? 0} structures · {formatDateTime(summary.fetchedAtISO)}
            </>
          ) : (
            <>No cached Wave snapshot yet.</>
          )}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className={mode === "resources" ? "btn btn--accent btn--sm" : "btn btn--ghost btn--sm"} onClick={() => onModeChange("resources")}>
            <Database size={12} /> Data
          </button>
          <button className={mode === "structures" ? "btn btn--accent btn--sm" : "btn btn--ghost btn--sm"} onClick={() => onModeChange("structures")}>
            <Braces size={12} /> Structures
          </button>
          <button className="btn-action" disabled={busy} onClick={onRefresh}>
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      <div className="card__body" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {mode === "resources" && (
          <>
            <button
              className={resourceType === "all" ? "btn btn--accent btn--sm" : "btn btn--ghost btn--sm"}
              onClick={() => onResourceTypeChange("all")}
            >
              All <span className="muted">{totalResources}</span>
            </button>
            {resourceTypes.map((type) => (
              <button
                key={type}
                className={resourceType === type ? "btn btn--accent btn--sm" : "btn btn--ghost btn--sm"}
                onClick={() => onResourceTypeChange(type)}
              >
                {waveTypeLabel(type)} <span className="muted">{counts[type] ?? 0}</span>
              </button>
            ))}
          </>
        )}
        <input
          className="input"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={mode === "resources" ? "Search cached Wave data" : "Search structures"}
          style={{ marginLeft: "auto", maxWidth: 280 }}
        />
      </div>

      {mode === "resources" ? (
        <>
          <table className="table">
            <thead>
              <tr>
                <th>Resource</th>
                <th>Type</th>
                <th>Status</th>
                <th>Value</th>
                <th>Date</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {resources.map((row) => (
                <tr key={row._id}>
                  <td>
                    <strong>{row.label}</strong>
                    {row.secondaryLabel && <div className="muted" style={{ fontSize: 12 }}>{row.secondaryLabel}</div>}
                  </td>
                  <td>
                    <Badge>{waveTypeLabel(row.resourceType)}</Badge>
                    {(row.typeValue || row.subtypeValue) && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {[row.typeValue, row.subtypeValue].filter(Boolean).join(" / ")}
                      </div>
                    )}
                  </td>
                  <td>{row.status ? <Badge tone={row.status === "archived" ? "neutral" : "info"}>{row.status}</Badge> : "—"}</td>
                  <td className="table__cell--mono">{formatWaveValue(row.amountValue, row.currencyCode)}</td>
                  <td className="table__cell--mono">{row.dateValue ?? "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn btn--ghost btn--sm" onClick={() => onSelectResource(row._id)}>
                      <ExternalLink size={12} /> Raw
                    </button>
                  </td>
                </tr>
              ))}
              {resources.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted" style={{ textAlign: "center", padding: 16 }}>
                    {summary ? "No cached rows match this view." : "Refresh the Wave cache to load data."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {selectedResourceId && (
            <div className="card__body" style={{ borderTop: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <Braces size={14} />
                <strong>{selectedResource?.label ?? "Wave resource"}</strong>
                {selectedResource?.externalId && <span className="muted table__cell--mono">{selectedResource.externalId}</span>}
              </div>
              <pre style={rawBlockStyle}>{selectedRaw}</pre>
            </div>
          )}
        </>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Kind</th>
              <th>Fields</th>
            </tr>
          </thead>
          <tbody>
            {structures.map((row) => (
              <tr key={row._id}>
                <td><strong>{row.typeName}</strong></td>
                <td><Badge>{row.kind}</Badge></td>
                <td>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(row.fields ?? []).slice(0, 16).map((field: any) => (
                      <span key={field.name} className="cell-tag">{field.name}</span>
                    ))}
                    {(row.fields?.length ?? 0) > 16 && <span className="muted">+{row.fields.length - 16}</span>}
                  </div>
                </td>
              </tr>
            ))}
            {structures.length === 0 && (
              <tr>
                <td colSpan={3} className="muted" style={{ textAlign: "center", padding: 16 }}>
                  {summary ? "No cached structures match this view." : "Refresh the Wave cache to load structures."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ProviderCard({
  name,
  desc,
  status,
  onConnect,
  busy,
}: {
  name: string;
  desc: string;
  status: "live" | "demo" | "setup" | "planned";
  onConnect?: () => void;
  busy?: boolean;
}) {
  const statusLabel = status === "setup" ? "setup required" : status;
  const statusTone = status === "live" ? "success" : status === "demo" ? "info" : status === "setup" ? "warn" : "neutral";
  return (
    <div
      className="panel"
      style={{
        padding: 12,
        border: "1px solid var(--border)",
        borderRadius: 8,
        minWidth: 220,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong>{name}</strong>
        <Badge tone={statusTone}>{statusLabel}</Badge>
      </div>
      <div className="muted" style={{ fontSize: 12, margin: "6px 0 10px" }}>
        {desc}
      </div>
      {onConnect ? (
        <button className="btn btn--accent btn--sm" disabled={busy} onClick={onConnect}>
          <Link2 size={12} /> Connect
        </button>
      ) : status === "setup" ? (
        <button className="btn btn--ghost btn--sm" disabled>
          Configure Wave
        </button>
      ) : (
        <button className="btn btn--ghost btn--sm" disabled>
          Coming soon
        </button>
      )}
    </div>
  );
}

const rawBlockStyle = {
  maxHeight: 360,
  overflow: "auto",
  padding: 12,
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--surface-muted)",
  fontSize: 12,
  lineHeight: 1.5,
} as const;

function waveTypeLabel(type: string) {
  const labels: Record<string, string> = {
    availableBusiness: "Available business",
    business: "Business",
    account: "Accounts",
    vendor: "Vendors",
    customer: "Customers",
    product: "Products",
    invoice: "Invoices",
    estimate: "Estimates",
    salesTax: "Sales taxes",
  };
  return labels[type] ?? type;
}

function formatWaveValue(value?: string, currencyCode?: string) {
  if (value == null || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  if (!currencyCode) return amount.toLocaleString("en-CA");
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: currencyCode }).format(amount);
}
