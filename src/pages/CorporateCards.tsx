import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { CreditCard, Plus, Receipt, Scale, Wallet } from "lucide-react";
import { api } from "@/lib/convexApi";
import { ObjectRecordTable, RecordTableEmpty } from "@/platform/record-engine";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { usePermissions } from "../hooks/usePermissions";
import { useSociety } from "../hooks/useSociety";
import { useUrlTab } from "../hooks/useUrlTab";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge } from "../components/ui";
import { Tabs } from "../components/primitives";
import { StatTile } from "../components/StatTile";
import { Money } from "../components/Money";
import { formatDate, pluralize } from "../lib/format";
import { formatMoney } from "../lib/money";
import { periodLabel, STATEMENT_STATUS_LABEL } from "../../shared/businessRegisters";
import { CardDrawer, StatementDrawer } from "../features/businessRegisters/CardDrawers";
import type { CardsWorkspace, PayrollEmployee } from "../features/businessRegisters/types";

const TABS = ["statements", "cards"] as const;
type CardsTab = (typeof TABS)[number];
type DrawerState = { kind: "card"; id: string | null } | { kind: "statement"; id: string | null } | null;

const STATEMENT_TONE = { reconciled: "success", balanced: "info", difference: "danger" } as const;

/**
 * Credit cards register: the organization's cards (last four digits only),
 * cardholder agreements, and each monthly statement reconciled against the
 * card lines already in the bank feed. No card issuing and no payments.
 */
export function CorporateCardsPage() {
  const society = useSociety();
  const { canWrite } = useFinancePermissions();
  const { loaded, can } = usePermissions();
  const workspace = useQuery(api.corporateCards.workspace, society ? { societyId: society._id } : "skip") as CardsWorkspace | undefined;
  const documents = useQuery(api.documents.listSummaries, society && loaded && can("documents:read") ? { societyId: society._id } : "skip") as Array<{ _id: string; title?: string; fileName?: string }> | undefined;
  const employees = useQuery(api.employees.list, society && loaded && can("employees:read") ? { societyId: society._id } : "skip") as Array<Record<string, any>> | undefined;
  const [tab, setTab] = useUrlTab(TABS, "statements");
  const [drawer, setDrawer] = useState<DrawerState>(null);

  const documentOptions = useMemo(() => (documents ?? []).map((doc) => ({ _id: doc._id, title: doc.title ?? doc.fileName ?? "Untitled" })), [documents]);
  const staff = useMemo<PayrollEmployee[]>(() => (employees ?? []).filter((row) => !row.endDate).map((row) => ({ _id: row._id, name: `${row.firstName} ${row.lastName}`.trim(), active: true })), [employees]);
  const cardRecords = useMemo(() => (workspace?.cards ?? []).map((card) => ({ ...card, card: `${card.network ?? card.issuer} ••${card.last4}` })), [workspace?.cards]);
  const statementRecords = useMemo(() => (workspace?.statements ?? []).map((row) => ({ ...row, period: periodLabel(row.periodStart, row.periodEnd) })), [workspace?.statements]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const summary = workspace?.summary;
  const close = () => setDrawer(null);
  const activeCard = drawer?.kind === "card" && drawer.id ? workspace?.cards.find((row) => row._id === drawer.id) ?? null : null;
  const activeStatement = drawer?.kind === "statement" && drawer.id ? workspace?.statements.find((row) => row._id === drawer.id) ?? null : null;
  const noCards = workspace !== undefined && workspace.cards.length === 0;

  return (
    <div className="page business-register-page">
      <PageHeader
        title="Credit cards"
        icon={<CreditCard size={16} />}
        iconColor="green"
        subtitle="Cards held in the organization's name, their statements and missing receipts."
        info={
          <p>
            Keep the cardholder, limit and agreement for each card, then reconcile every monthly statement against the card lines in the bank feed.
            Only the last four digits of a card number are stored. Societyer doesn't issue cards or make card payments.
          </p>
        }
        actions={
          <>
            {tab === "statements" && !noCards ? (
              <button type="button" className="btn-action btn-action--primary" disabled={!canWrite || !workspace} onClick={() => setDrawer({ kind: "statement", id: null })}>
                <Plus size={12} aria-hidden="true" /> New statement
              </button>
            ) : (
              <button type="button" className="btn-action btn-action--primary" disabled={!canWrite || !workspace} onClick={() => setDrawer({ kind: "card", id: null })}>
                <Plus size={12} aria-hidden="true" /> New card
              </button>
            )}
          </>
        }
      />

      <div className="stat-grid" role="group" aria-label="Card summary">
        <StatTile
          label="Balance owed"
          icon={<Wallet size={14} />}
          value={<Money variant="hero" cents={summary ? summary.balanceCents : null} />}
          sub={summary ? `${pluralize(summary.activeCards, "active card")}${summary.totalLimitCents ? ` · limit ${formatMoney(summary.totalLimitCents, { trimWholeCents: true })}` : ""}` : undefined}
          onClick={() => setTab("cards")}
          pressed={tab === "cards"}
          actionLabel="Show cards"
        />
        <StatTile
          label="To reconcile"
          icon={<Scale size={14} />}
          value={summary ? String(summary.toReconcile) : "—"}
          tone={summary?.withDifference ? "warn" : "neutral"}
          sub={summary ? (summary.withDifference ? `${pluralize(summary.withDifference, "statement")} with a difference` : summary.toReconcile ? "Balances match the feed" : "All reconciled") : undefined}
          subTone={summary?.withDifference ? "warn" : undefined}
          onClick={() => setTab("statements")}
          pressed={tab === "statements"}
          actionLabel="Show statements"
        />
        <StatTile
          label="Receipts missing"
          icon={<Receipt size={14} />}
          value={summary ? String(summary.receiptsMissing) : "—"}
          tone={summary?.receiptsMissing ? "warn" : "neutral"}
          sub="On statements not yet reconciled"
          href="/app/financials?tab=transactions"
          actionLabel="Open transactions to attach receipts"
        />
      </div>

      <Tabs<CardsTab>
        value={tab}
        onChange={setTab}
        tabRoles
        ariaLabel="Card records"
        items={[
          { id: "statements", label: "Statements", count: summary?.toReconcile || null },
          { id: "cards", label: "Cards", count: workspace?.cards.length ?? null },
        ]}
      />

      {tab === "cards" && (
        <ObjectRecordTable
          societyId={society._id}
          nameSingular="corporateCard"
          label="All cards"
          objectLabel="card"
          icon={<CreditCard size={14} />}
          records={cardRecords}
          loading={workspace === undefined}
          onRecordClick={(id) => setDrawer({ kind: "card", id })}
          renderCell={({ record, field }) => {
            if (field.name === "card") return <span className="register-card-chip"><CreditCard size={12} aria-hidden="true" /> {record.card}</span>;
            if (field.name === "status") return <Badge tone={record.status === "active" ? "success" : "neutral"}>{record.status === "active" ? "Active" : "Closed"}</Badge>;
            if (field.name === "receiptsMissing") return record.receiptsMissing ? <Badge tone="warn">{record.receiptsMissing}</Badge> : <span className="num muted">0</span>;
            return undefined;
          }}
          emptyState={
            <RecordTableEmpty
              title="No cards yet"
              description="Add each card held in the organization's name with its cardholder, limit and agreement."
              action={canWrite ? <button className="btn btn--accent btn--sm" onClick={() => setDrawer({ kind: "card", id: null })}><Plus size={12} /> New card</button> : undefined}
            />
          }
        />
      )}

      {tab === "statements" && (
        <ObjectRecordTable
          societyId={society._id}
          nameSingular="cardStatement"
          label="All statements"
          objectLabel="card statement"
          icon={<Receipt size={14} />}
          records={statementRecords}
          loading={workspace === undefined}
          onRecordClick={(id) => setDrawer({ kind: "statement", id })}
          renderCell={({ record, field }) => {
            if (field.name === "status") return <Badge tone={STATEMENT_TONE[record.status as keyof typeof STATEMENT_TONE] ?? "neutral"}>{STATEMENT_STATUS_LABEL[record.status as keyof typeof STATEMENT_STATUS_LABEL] ?? record.status}</Badge>;
            if (field.name === "differenceCents") return <Money cents={record.differenceCents} tone={record.differenceCents ? "out" : "neutral"} signDisplay="exceptZero" />;
            if (field.name === "receiptsMissing") return record.receiptsMissing ? <Badge tone="warn">{record.receiptsMissing}</Badge> : <span className="num muted">0</span>;
            if (field.name === "paymentDueDate") return record.paymentDueDate ? <span className="num">{formatDate(record.paymentDueDate)}</span> : <span className="muted">—</span>;
            return undefined;
          }}
          emptyState={
            <RecordTableEmpty
              title={noCards ? "Add a card first" : "No statements yet"}
              description={noCards ? "Statements belong to a card. Add the card, then enter each month's statement balance." : "Enter each month's statement balance to check it against the card lines in the feed."}
              action={canWrite ? <button className="btn btn--accent btn--sm" onClick={() => setDrawer({ kind: noCards ? "card" : "statement", id: null })}><Plus size={12} /> {noCards ? "New card" : "New statement"}</button> : undefined}
            />
          }
        />
      )}

      <CardDrawer open={drawer?.kind === "card"} onClose={close} societyId={society._id} card={activeCard} accounts={workspace?.accounts ?? []} documents={documentOptions} employees={staff} canWrite={canWrite} />
      <StatementDrawer open={drawer?.kind === "statement"} onClose={close} societyId={society._id} statement={activeStatement} cards={workspace?.cards ?? []} documents={documentOptions} canWrite={canWrite} today={workspace?.today ?? ""} />
    </div>
  );
}
