/**
 * The procurement reader's list of one kind: every opportunity or award the
 * source holds, loaded progressively into the shared record table (toolbar,
 * column picker, density, phone cards), so sorting, filtering and search see
 * the whole catalog. The view preset and the search live in the URL with the
 * kind, so a notice's Back returns to the same list.
 */
import { NoticeTable, isNoticeView, type NoticeKind } from "./NoticeTable";
import { useReaderNavigation } from "./routes";
import { useReaderSource } from "./source";

export function CatalogBrowser({ kind }: { kind: NoticeKind }) {
  const source = useReaderSource();
  const { params, update } = useReaderNavigation();
  return source.usePage ? (
    <PagedCatalog kind={kind} />
  ) : (
    <SnapshotCatalog kind={kind} />
  );
}

function SnapshotCatalog({ kind }: { kind: NoticeKind }) {
  const source = useReaderSource();
  const { params, update } = useReaderNavigation();
  const list = source.useList(kind);
  const requested = params.get("status");
  const view =
    kind === "opportunity" && isNoticeView(requested) ? requested : "upcoming";
  const search = params.get("q") ?? "";
  return (
    <NoticeTable
      key={kind}
      kind={kind}
      rows={list?.rows ?? EMPTY}
      tableId={`procurement-review:${kind}`}
      view={view}
      onChangeView={(next) =>
        update({ status: next === "upcoming" ? null : next })
      }
      search={search}
      onSearch={(value) => update({ q: value || null })}
      progress={{
        loaded: list?.rows.length ?? 0,
        total: list?.total ?? source.catalog.counts[kind] ?? 0,
        done: list?.done ?? false,
      }}
    />
  );
}

const EMPTY: never[] = [];

function PagedCatalog({ kind }: { kind: NoticeKind }) {
  const { params, update } = useReaderNavigation();
  const requested = params.get("status");
  const view =
    kind === "opportunity" && isNoticeView(requested) ? requested : "upcoming";
  return (
    <NoticeTable
      kind={kind}
      rows={EMPTY}
      tableId={`procurement-review:${kind}`}
      view={view}
      onChangeView={(next) =>
        update({ status: next === "upcoming" ? null : next })
      }
      search={params.get("q") ?? ""}
      onSearch={(q) => update({ q: q || null })}
      serverPaging
    />
  );
}
