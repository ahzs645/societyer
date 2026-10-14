import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { ArrowUpLeft, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, CornerDownRight, MoreHorizontal } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Menu } from "../../../components/Menu";
import { Badge, Drawer, Field } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { useToast } from "../../../components/Toast";
import {
  MAX_ACCOUNT_DEPTH,
  accountParentError,
  accountSection,
  buildAccountTree,
  eligibleParents,
  type AccountTreeNode,
  type HierarchyAccount,
} from "../../../../shared/accountHierarchy";
import { ACCOUNT_SECTIONS } from "../lib/ledgerReports";

type ChartAccount = HierarchyAccount & { subtype?: string; isRestricted?: boolean };
type FlatAccount = { node: AccountTreeNode<ChartAccount>; hidden: boolean; collapsed: boolean };

const TOP_LEVEL = "__top";

const accountLabel = (account: HierarchyAccount) => (account.code ? `${account.code} ${account.name}` : account.name);

function sectionFor(account: HierarchyAccount) {
  const section = accountSection(account.accountType);
  return ACCOUNT_SECTIONS.find((candidate) => candidate.id === section) ?? { id: section, label: account.accountType || "Other", types: [account.accountType] };
}

function flatten(nodes: AccountTreeNode<ChartAccount>[], collapsed: Set<string>) {
  const out: FlatAccount[] = [];
  const walk = (list: AccountTreeNode<ChartAccount>[], hidden: boolean) => {
    for (const node of list) {
      const id = String(node.account._id);
      const isCollapsed = node.children.length > 0 && collapsed.has(id);
      out.push({ node, hidden, collapsed: isCollapsed });
      walk(node.children, hidden || isCollapsed);
    }
  };
  walk(nodes, false);
  return out;
}

/**
 * Chart of accounts as a tree: sub-accounts indented under their parent,
 * grouped by statement section, with "Move under…" and "Move up a level".
 * Statements and the trial balance roll sub-accounts up into the parent.
 */
export function ChartOfAccountsCard({ accounts, canWrite }: { accounts: ChartAccount[] | undefined; canWrite: boolean }) {
  const toast = useToast();
  const setParent = useMutation(api.accounting.setAccountParent);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [moving, setMoving] = useState<{ accountId: string; parentId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => accounts ?? [], [accounts]);
  const byId = useMemo(() => new Map(rows.map((account) => [String(account._id), account])), [rows]);

  const sections = useMemo(() => {
    const groups = new Map<string, { id: string; label: string; nodes: AccountTreeNode<ChartAccount>[] }>();
    for (const node of buildAccountTree(rows)) {
      const section = sectionFor(node.account);
      const group = groups.get(section.id) ?? { id: section.id, label: section.label, nodes: [] };
      group.nodes.push(node);
      groups.set(section.id, group);
    }
    const order = ACCOUNT_SECTIONS.map((section) => section.id);
    return [...groups.values()].sort((a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99));
  }, [rows]);
  const parentIds = useMemo(() => new Set(rows.filter((row) => row.parentAccountId && byId.has(String(row.parentAccountId))).map((row) => String(row.parentAccountId))), [byId, rows]);
  const allCollapsed = parentIds.size > 0 && [...parentIds].every((id) => collapsed.has(id));

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const move = async (accountId: string, parentId: string | null, opts: { undo?: boolean } = {}) => {
    const account = byId.get(accountId);
    if (!account) return;
    const previous = account.parentAccountId ? String(account.parentAccountId) : null;
    const error = accountParentError(rows, accountId, parentId);
    if (error) {
      toast.error("Can't move that account", error);
      return false;
    }
    setBusy(true);
    try {
      await setParent({ id: accountId as any, ...(parentId ? { parentAccountId: parentId as any } : {}) });
      if (parentId) setCollapsed((prev) => { const next = new Set(prev); next.delete(parentId); return next; });
      if (!opts.undo) {
        const parent = parentId ? byId.get(parentId) : null;
        toast.success(parent ? `Moved under ${accountLabel(parent)}` : `${accountLabel(account)} is now a top-level account`, {
          action: { label: "Undo", onClick: () => void move(accountId, previous, { undo: true }) },
        });
      }
      return true;
    } catch (e) {
      toast.error("Couldn't move the account", e instanceof Error ? e.message : undefined);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const movingAccount = moving ? byId.get(moving.accountId) : undefined;
  const parentOptions = useMemo(() => (moving ? eligibleParents(rows, moving.accountId) : []), [moving, rows]);

  return (
    <section className="card coa-card" aria-labelledby="coa-title">
      <div className="card__head">
        <div>
          <h2 className="card__title" id="coa-title">Chart of accounts</h2>
          <span className="card__subtitle">Sub-accounts roll up into their parent on the statements and trial balance.</span>
        </div>
        {parentIds.size > 0 && (
          <button type="button" className="btn btn--ghost btn--sm coa-card__expand" onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(parentIds))}>
            {allCollapsed ? <ChevronsUpDown size={14} aria-hidden="true" /> : <ChevronsDownUp size={14} aria-hidden="true" />}
            {allCollapsed ? "Expand all" : "Collapse all"}
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="muted accounting-empty">No accounts yet. Use More → Set up standard chart of accounts.</div>
      ) : (
        <div className="coa-sections">
          {sections.map((section) => (
            <div key={section.id} className="coa-section">
              <h3 className="coa-section__title">{section.label}</h3>
              <ul className="coa-list">
                {flatten(section.nodes, collapsed).filter((entry) => !entry.hidden).map(({ node, collapsed: isCollapsed }) => {
                  const account = node.account;
                  const id = String(account._id);
                  const parent = account.parentAccountId ? byId.get(String(account.parentAccountId)) : undefined;
                  const grandparentId = parent?.parentAccountId ? String(parent.parentAccountId) : null;
                  const hasChildren = node.children.length > 0;
                  return (
                    <li key={id} className="coa-row" data-depth={Math.min(node.depth, MAX_ACCOUNT_DEPTH)}>
                      {hasChildren ? (
                        <button
                          type="button"
                          className="coa-row__toggle"
                          aria-expanded={!isCollapsed}
                          aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${accountLabel(account)}`}
                          onClick={() => toggle(id)}
                        >
                          {isCollapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                        </button>
                      ) : (
                        <span className="coa-row__toggle coa-row__toggle--spacer" aria-hidden="true">
                          {node.depth > 1 && <CornerDownRight size={12} />}
                        </span>
                      )}
                      <span className="coa-row__label">
                        {account.code && <span className="coa-row__code">{account.code}</span>}
                        <span className="coa-row__name">{account.name}</span>
                        {hasChildren && <span className="coa-row__count">{node.children.length} sub-account{node.children.length === 1 ? "" : "s"}</span>}
                      </span>
                      <span className="coa-row__meta">
                        <Badge tone="neutral">{account.accountType}</Badge>
                        {account.isRestricted && <Badge tone="warn">Restricted</Badge>}
                      </span>
                      <Menu
                        align="right"
                        minWidth={200}
                        trigger={
                          <button type="button" className="btn btn--ghost btn--sm btn--icon coa-row__menu" aria-label={`Actions for ${accountLabel(account)}`} disabled={!canWrite || busy}>
                            <MoreHorizontal size={14} aria-hidden="true" />
                          </button>
                        }
                        sections={[{
                          id: "move",
                          items: [
                            { id: "under", label: "Move under…", icon: <CornerDownRight size={14} />, onSelect: () => setMoving({ accountId: id, parentId: parent ? String(parent._id) : TOP_LEVEL }) },
                            ...(parent
                              ? [{ id: "up", label: grandparentId ? "Move up a level" : "Make top-level account", icon: <ArrowUpLeft size={14} />, onSelect: () => void move(id, grandparentId) }]
                              : []),
                          ],
                        }]}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      <Drawer
        open={Boolean(moving && movingAccount)}
        onClose={() => setMoving(null)}
        title={movingAccount ? `Move ${accountLabel(movingAccount)}` : "Move account"}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setMoving(null)}>Cancel</button>
            <button
              type="button"
              className="btn btn--accent"
              disabled={!canWrite || busy || !moving}
              onClick={async () => {
                if (!moving) return;
                const ok = await move(moving.accountId, moving.parentId === TOP_LEVEL ? null : moving.parentId);
                if (ok) setMoving(null);
              }}
            >
              Move
            </button>
          </>
        }
      >
        {moving && movingAccount && (
          <div className="col">
            <Field label="Parent account" hint={`Only ${sectionFor(movingAccount).label.toLowerCase()} accounts in ${movingAccount.currency || "the same currency"} are listed. Accounts nest at most ${MAX_ACCOUNT_DEPTH} levels deep, and an account can't move under one of its own sub-accounts.`}>
              <Select
                value={moving.parentId}
                onChange={(parentId) => setMoving({ ...moving, parentId })}
                options={[
                  { value: TOP_LEVEL, label: "None (top-level account)" },
                  ...parentOptions.map((candidate) => {
                    const above = candidate.parentAccountId ? byId.get(String(candidate.parentAccountId)) : undefined;
                    return { value: String(candidate._id), label: above ? `${accountLabel(candidate)} (under ${above.code ?? above.name})` : accountLabel(candidate) };
                  }),
                ]}
              />
            </Field>
            <p className="muted coa-move-note">Posted journal lines stay on {accountLabel(movingAccount)}; only where it appears on the statements changes.</p>
          </div>
        )}
      </Drawer>
    </section>
  );
}
