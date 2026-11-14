/**
 * The procurement reader's list of one kind: every opportunity or award the
 * source holds, loaded progressively into the shared record table (toolbar,
 * column picker, density, phone cards), so sorting, filtering and search see
 * the whole catalog. The view (a queue state or another view, queue.ts) and
 * the search live in the URL with the kind, so a notice's Back returns to the
 * same list.
 *
 * With no view in the URL the list opens on the view this person was last on
 * (per workspace, person and browser), so the queue state they work in
 * becomes their default; a view in the URL always wins. Choosing the default
 * view leaves it out of the URL, as before, so older links keep working.
 */
import { useCallback, useMemo, useState } from "react";
import { useSociety } from "../../../hooks/useSociety";
import { useCurrentUserId } from "../../../hooks/useCurrentUser";
import { NoticeTable, type NoticeKind } from "./NoticeTable";
import { useReaderNavigation } from "./routes";
import { useReaderSource } from "./source";
import { useReaderTriage } from "./triage";
import { availableView, defaultNoticeView, isNoticeView, readRememberedView, rememberView, type NoticeViewId } from "./queue";

export function CatalogBrowser({ kind }: { kind: NoticeKind }) {
  const source = useReaderSource();
  return source.usePage ? (
    <PagedCatalog kind={kind} />
  ) : (
    <SnapshotCatalog kind={kind} />
  );
}

/**
 * The view the list shows: the URL's, else the one remembered for this
 * person, else the default. Choosing one writes it to the URL (the default
 * as no `status` at all) and remembers it.
 */
function useCatalogView(kind: NoticeKind, tableId: string, triaged: boolean) {
  const { params, update } = useReaderNavigation();
  const society = useSociety() as { _id?: string } | null | undefined;
  const userId = useCurrentUserId();
  const societyId = society?._id ? String(society._id) : null;
  const person = societyId && userId ? String(userId) : null;
  const fallback = defaultNoticeView(triaged);
  const stored = useMemo(
    () => (societyId && person ? readRememberedView(societyId, person, tableId) : null),
    [societyId, person, tableId],
  );
  // What was chosen during this visit, over what was stored before it.
  const [chosen, setChosen] = useState<NoticeViewId | null>(null);
  const requested = params.get("status");
  const view: NoticeViewId =
    kind !== "opportunity" ? "all"
      : isNoticeView(requested) ? requested
      : availableView(chosen ?? stored ?? fallback, triaged);
  const choose = useCallback(
    (next: NoticeViewId) => {
      if (societyId && person) rememberView(societyId, person, tableId, next);
      setChosen(next);
      update({ status: next === fallback ? null : next });
    },
    [societyId, person, tableId, update, fallback],
  );
  return { view, choose };
}

function SnapshotCatalog({ kind }: { kind: NoticeKind }) {
  const source = useReaderSource();
  const { params, update } = useReaderNavigation();
  const triage = useReaderTriage();
  const tableId = `procurement-review:${kind}`;
  const { view, choose } = useCatalogView(kind, tableId, kind === "opportunity" && !!triage);
  const list = source.useList(kind);
  const search = params.get("q") ?? "";
  return (
    <NoticeTable
      key={kind}
      kind={kind}
      rows={list?.rows ?? EMPTY}
      tableId={tableId}
      view={view}
      onChangeView={choose}
      search={search}
      onSearch={(value) => update({ q: value || null })}
      progress={{
        loaded: list?.rows.length ?? 0,
        total: list?.total ?? source.catalog.counts[kind] ?? 0,
        done: list?.done ?? false,
      }}
      publishOrder
      keyboardShortcuts
    />
  );
}

const EMPTY: never[] = [];

function PagedCatalog({ kind }: { kind: NoticeKind }) {
  const { params, update } = useReaderNavigation();
  const tableId = `procurement-review:${kind}`;
  // A list paged by the server has no triage (NoticeTable.tsx).
  const { view, choose } = useCatalogView(kind, tableId, false);
  return (
    <NoticeTable
      kind={kind}
      rows={EMPTY}
      tableId={tableId}
      view={view}
      onChangeView={choose}
      search={params.get("q") ?? ""}
      onSearch={(q) => update({ q: q || null })}
      serverPaging
      publishOrder
      keyboardShortcuts
    />
  );
}
