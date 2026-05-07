import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type PinnedView = {
  viewsKey: string;
  viewId: string;
  label: string;
  /** Absolute route for the underlying page, e.g. `/app/members`. */
  to: string;
};

type UIState = {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (value: boolean) => void;
  toggleSidebar: () => void;

  pinnedViews: PinnedView[];
  pinView: (entry: PinnedView) => void;
  unpinView: (viewsKey: string, viewId: string) => void;
  isViewPinned: (viewsKey: string, viewId: string) => boolean;
  reorderPinnedView: (fromIndex: number, toIndex: number) => void;

  /** Selected row ids keyed by table scope (usually `viewsKey` or route). */
  selection: Record<string, string[]>;
  setSelection: (scope: string, ids: string[]) => void;
  clearSelection: (scope: string) => void;

  /** Last view the user applied per viewsKey — surfaced when returning to that module. */
  lastViewByModule: Record<string, string>;
  setLastView: (viewsKey: string, viewId: string) => void;
  clearLastView: (viewsKey: string) => void;

  /** Ring buffer of recently visited records — fed by useTrackRecentRecord. */
  recentRecords: RecentRecord[];
  pushRecentRecord: (record: RecentRecord) => void;
};

export type RecentRecord = {
  entityType: string;
  id: string;
  label: string;
  to: string;
  at: number;
};

const RECENT_RECORDS_MAX = 10;

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      sidebarCollapsed: false,
      setSidebarCollapsed: (value) => set({ sidebarCollapsed: value }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      pinnedViews: [],
      pinView: (entry) =>
        set((s) => ({
          pinnedViews: [
            ...s.pinnedViews.filter(
              (p) => !(p.viewsKey === entry.viewsKey && p.viewId === entry.viewId),
            ),
            entry,
          ],
        })),
      unpinView: (viewsKey, viewId) =>
        set((s) => ({
          pinnedViews: s.pinnedViews.filter(
            (p) => !(p.viewsKey === viewsKey && p.viewId === viewId),
          ),
        })),
      isViewPinned: (viewsKey, viewId) =>
        get().pinnedViews.some((p) => p.viewsKey === viewsKey && p.viewId === viewId),
      reorderPinnedView: (fromIndex, toIndex) =>
        set((s) => {
          if (fromIndex === toIndex) return s;
          if (fromIndex < 0 || fromIndex >= s.pinnedViews.length) return s;
          const next = s.pinnedViews.slice();
          const [moved] = next.splice(fromIndex, 1);
          const clamped = Math.max(0, Math.min(toIndex, next.length));
          next.splice(clamped, 0, moved);
          return { pinnedViews: next };
        }),

      selection: {},
      setSelection: (scope, ids) =>
        set((s) => ({ selection: { ...s.selection, [scope]: ids } })),
      clearSelection: (scope) =>
        set((s) => {
          const { [scope]: _, ...rest } = s.selection;
          return { selection: rest };
        }),

      lastViewByModule: {},
      setLastView: (viewsKey, viewId) =>
        set((s) => ({
          lastViewByModule: { ...s.lastViewByModule, [viewsKey]: viewId },
        })),
      clearLastView: (viewsKey) =>
        set((s) => {
          const { [viewsKey]: _, ...rest } = s.lastViewByModule;
          return { lastViewByModule: rest };
        }),

      recentRecords: [],
      pushRecentRecord: (record) =>
        set((s) => {
          const without = s.recentRecords.filter(
            (r) => !(r.entityType === record.entityType && r.id === record.id),
          );
          return {
            recentRecords: [record, ...without].slice(0, RECENT_RECORDS_MAX),
          };
        }),
    }),
    {
      name: "societyer.ui",
      storage: createJSONStorage(() => localStorage),
      // Selection is session-scoped — don't persist it to localStorage.
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        pinnedViews: state.pinnedViews,
        lastViewByModule: state.lastViewByModule,
        recentRecords: state.recentRecords,
      }) as any,
    },
  ),
);
