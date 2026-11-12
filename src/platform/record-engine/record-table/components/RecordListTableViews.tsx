import { useCallback, useEffect, useMemo, useRef, type ComponentProps, type MutableRefObject } from "react";
import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/lib/convexApi";
import type { HydratedView } from "../../types";
import { useRecordTableState, useRecordTableStoreHandle, useRecordTableStoreOrThrow } from "../state/recordTableStore";
import { applyTableSlices } from "../utils/listTableMemory";
import { hydratedViewFromListViewState, listViewStateFromTable } from "../utils/listViewState";
import { parseListViewStateJson, type ListViewState } from "../../../../../shared/listViewState";
import { RecordTableToolbar } from "./RecordTableToolbar";

/**
 * Query parameter naming the list's named view, e.g. `/app/invoices?view=<id>`:
 * opening the link shows that view, and choosing a view writes it so the
 * address can be shared.
 */
export const LIST_VIEW_PARAM = "view";

type ListViewRow = { _id: string; name: string; stateJson: string };
type SavedListView = { _id: string; name: string; state: ListViewState };

type ToolbarProps = Omit<
  ComponentProps<typeof RecordTableToolbar>,
  "views" | "currentViewId" | "onChangeView" | "onSaveView" | "onSaveAsView" | "saveAsViewMessage" | "onRenameView" | "onDeleteView"
>;

/**
 * The list's toolbar with its named views (`listViews`), shared with the
 * workspace: the views menu lists the list's default view (named by `label`)
 * then the saved ones; Save updates the named view on show, Save as creates
 * one, and the menu renames or deletes the one on show. Saving needs
 * settings:write (the toolbar disables it otherwise; the server checks it).
 */
export function RecordListTableViews({
  societyId,
  tableId,
  base,
  rememberedViewId,
  toolbar,
}: {
  societyId: string;
  tableId: string;
  /** The list's default view, as defined in code. */
  base: HydratedView;
  /** The named view the browser remembered the list on (see listTableMemory). */
  rememberedViewId: MutableRefObject<string | null>;
  toolbar: ToolbarProps;
}) {
  const rows = useQuery(api.listViews.list, { societyId, tableId }) as ListViewRow[] | undefined;
  const createView = useMutation(api.listViews.create);
  const updateView = useMutation(api.listViews.update);
  const removeView = useMutation(api.listViews.remove);
  const store = useRecordTableStoreOrThrow();
  const handle = useRecordTableStoreHandle();
  const viewId = useRecordTableState((state) => state.viewId);
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultId = base.view._id;

  // A row that no longer reads (written by a newer version, say) is left out.
  const savedViews = useMemo<SavedListView[] | undefined>(
    () =>
      rows?.flatMap((row) => {
        try {
          return [{ _id: String(row._id), name: row.name, state: parseListViewStateJson(row.stateJson) }];
        } catch {
          return [];
        }
      }),
    [rows],
  );

  const load = useCallback(
    (view: SavedListView | null) => handle.get().loadView(view ? hydratedViewFromListViewState(base, view.state, view) : base),
    [base, handle],
  );
  // Makes `view` the saved one while keeping what is on show (and edited).
  const adopt = useCallback(
    (view: SavedListView | null, { keepSearch }: { keepSearch: boolean }) => {
      const live = handle.get();
      load(view);
      applyTableSlices(store, live);
      if (keepSearch) handle.set({ searchTerm: live.searchTerm });
    },
    [handle, load, store],
  );

  const savedViewsRef = useRef(savedViews);
  savedViewsRef.current = savedViews;
  const setViewParam = useCallback(
    (next: string | null) => {
      setSearchParams(
        (current) => {
          const existing = current.get(LIST_VIEW_PARAM);
          if (next ? existing === next : !existing) return current;
          // Clear only a value this list wrote (another `view` parameter belongs to the page).
          if (!next && existing !== defaultId && !savedViewsRef.current?.some((view) => view._id === existing)) return current;
          const params = new URLSearchParams(current);
          if (next) params.set(LIST_VIEW_PARAM, next);
          else params.delete(LIST_VIEW_PARAM);
          return params;
        },
        { replace: true },
      );
    },
    [defaultId, setSearchParams],
  );

  // Once the views have loaded: a `?view=` link shows its view; otherwise the
  // view the browser remembered becomes the saved one under the remembered
  // state. A view that disappears while on show (deleted elsewhere) hands
  // over to the default view, keeping what is on show.
  const requested = searchParams.get(LIST_VIEW_PARAM);
  const handledRequest = useRef<string | null>(null);
  const resolvedMemory = useRef(false);
  const previousIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!savedViews) return;
    const ids = new Set(savedViews.map((view) => view._id));
    const hadIds = previousIds.current;
    previousIds.current = ids;
    const current = handle.get().viewId;
    if (requested && handledRequest.current !== requested) {
      handledRequest.current = requested;
      const match = savedViews.find((view) => view._id === requested);
      if (match) {
        resolvedMemory.current = true;
        if (current !== match._id) load(match);
        return;
      }
    }
    if (!resolvedMemory.current) {
      resolvedMemory.current = true;
      const remembered = rememberedViewId.current;
      const match = remembered ? savedViews.find((view) => view._id === remembered) : undefined;
      if (match && current !== match._id) adopt(match, { keepSearch: false });
      return;
    }
    if (current && current !== defaultId && hadIds?.has(current) && !ids.has(current)) adopt(null, { keepSearch: true });
  }, [savedViews, requested, handle, load, adopt, defaultId, rememberedViewId]);

  const currentViewId = viewId ?? defaultId;
  const onNamedView = currentViewId !== defaultId && !!savedViews?.some((view) => view._id === currentViewId);
  const views = useMemo(
    () => [
      { _id: defaultId, name: toolbar.label, isSystem: true },
      ...(savedViews ?? []).map((view) => ({ _id: view._id, name: view.name, isSystem: false })),
    ],
    [defaultId, toolbar.label, savedViews],
  );

  return (
    <RecordTableToolbar
      {...toolbar}
      views={views}
      currentViewId={currentViewId}
      onChangeView={(next) => {
        if (next === defaultId) load(null);
        else {
          const view = savedViews?.find((entry) => entry._id === next);
          if (!view) return;
          load(view);
        }
        handledRequest.current = next === defaultId ? null : next;
        setViewParam(next === defaultId ? null : next);
      }}
      onSaveView={
        onNamedView
          ? async () => {
              const state = handle.get();
              const id = state.viewId;
              if (!id) return;
              // As with object views: a quick search over a view without one isn't part of it.
              const searchTerm = state.savedView?.searchTerm ? state.searchTerm : "";
              await updateView({ societyId, id, stateJson: JSON.stringify(listViewStateFromTable({ ...state, searchTerm }, { includeSearch: true })) });
              handle.get().markSaved({ ...state, searchTerm });
            }
          : undefined
      }
      onSaveAsView={async (name) => {
        const state = handle.get();
        const id = String(await createView({ societyId, tableId, name, stateJson: JSON.stringify(listViewStateFromTable(state, { includeSearch: true })) }));
        handle.set({ viewId: id });
        handle.get().markSaved();
        handledRequest.current = id;
        setViewParam(id);
        return id;
      }}
      saveAsViewMessage="Saves the current columns, filters, sort and grouping as a view everyone in the workspace can choose."
      onRenameView={async (id, name) => {
        await updateView({ societyId, id, name });
      }}
      onDeleteView={async (id) => {
        await removeView({ societyId, id });
        if (handle.get().viewId === id) adopt(null, { keepSearch: true });
        setViewParam(null);
      }}
    />
  );
}
