import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Clipboard,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Link2,
  Minus,
  MoreHorizontal,
  PanelRightOpen,
  X,
} from "lucide-react";
import { Menu } from "../../../../components/Menu";
import { useInspectorPanel } from "../../../../components/InspectorPanel";
import { Tooltip } from "../../../../components/Tooltip";
import { sameEntity, type EntityRef } from "../../../../components/HoverCard/entityRefs";
import { useDialogFocus } from "../../../../lib/useDialogFocus";

/** Cards a panel can hold at once, the table record included. */
export const MAX_PANEL_STACK_DEPTH = 5;

type StackState = {
  /** The table record the stack belongs to; a different record starts over. */
  baseId: string | null;
  /** Related records opened on top of the table record, oldest first. */
  stack: EntityRef[];
  /** 0 shows the table record; n shows stack[n - 1]. */
  active: number;
  minimised: boolean;
  fullscreen: boolean;
};

export type RecordPanelStack = ReturnType<typeof useRecordPanelStack>;

const NO_CARDS: EntityRef[] = [];

/**
 * State for a record panel's card stack: related records open on top of the
 * table record, the user moves back and forth between them, and the whole
 * panel can be minimised to a dock chip or expanded to full screen.
 */
export function useRecordPanelStack(baseRecordId: string | null) {
  const [state, setState] = useState<StackState>({
    baseId: null,
    stack: [],
    active: 0,
    minimised: false,
    fullscreen: false,
  });
  const belongs = state.baseId === baseRecordId && baseRecordId !== null;
  const stack = belongs ? state.stack : NO_CARDS;
  const active = belongs ? Math.min(state.active, stack.length) : 0;
  const minimised = belongs && state.minimised;
  const fullscreen = baseRecordId !== null && state.fullscreen;

  const update = useCallback(
    (fn: (current: StackState) => StackState) =>
      setState((previous) => {
        const current =
          previous.baseId === baseRecordId
            ? previous
            : { ...previous, baseId: baseRecordId, stack: [], active: 0, minimised: false };
        return fn(current);
      }),
    [baseRecordId],
  );

  const openRelated = useCallback(
    (ref: EntityRef) =>
      update((current) => {
        const visible = current.active === 0 ? null : current.stack[current.active - 1];
        if (sameEntity(visible, ref)) return { ...current, minimised: false };
        // Opening from a card drops the cards that were in front of it.
        let next = [...current.stack.slice(0, current.active), ref];
        // Keep the table record and the newest cards within the limit.
        while (next.length > MAX_PANEL_STACK_DEPTH - 1) next = next.slice(1);
        return { ...current, stack: next, active: next.length, minimised: false };
      }),
    [update],
  );

  const goTo = useCallback(
    (index: number) =>
      update((current) => ({
        ...current,
        active: Math.max(0, Math.min(index, current.stack.length)),
      })),
    [update],
  );

  /** Closes the visible card. Returns false when that was the table record. */
  const closeActive = useCallback(() => {
    if (active === 0) return false;
    update((current) => {
      const index = Math.min(current.active, current.stack.length);
      if (index === 0) return current;
      const next = current.stack.filter((_, position) => position !== index - 1);
      return { ...current, stack: next, active: index - 1 };
    });
    return true;
  }, [active, update]);

  /** Rebuilds a stack from a deep link, for the record about to open. */
  const restore = useCallback((baseId: string, refs: EntityRef[]) => {
    const next = refs.slice(-(MAX_PANEL_STACK_DEPTH - 1));
    setState((previous) => ({
      ...previous,
      baseId,
      stack: next,
      active: next.length,
      minimised: false,
    }));
  }, []);

  /** Records the visible card's resolved title (cards opened from a link carry none). */
  const nameActiveCard = useCallback(
    (name: string) =>
      update((current) => {
        const index = current.active - 1;
        const card = current.stack[index];
        if (!card || card.name === name) return current;
        const next = [...current.stack];
        next[index] = { ...card, name };
        return { ...current, stack: next };
      }),
    [update],
  );

  const setMinimised = useCallback(
    (value: boolean) => update((current) => ({ ...current, minimised: value })),
    [update],
  );
  const setFullscreen = useCallback(
    (value: boolean) => setState((previous) => ({ ...previous, fullscreen: value })),
    [],
  );
  const reset = useCallback(
    () => setState({ baseId: null, stack: [], active: 0, minimised: false, fullscreen: false }),
    [],
  );

  return useMemo(
    () => ({
      stack,
      active,
      depth: stack.length + 1,
      activeEntity: active === 0 ? null : stack[active - 1],
      minimised,
      fullscreen,
      openRelated,
      goTo,
      back: () => goTo(active - 1),
      forward: () => goTo(active + 1),
      closeActive,
      restore,
      nameActiveCard,
      setMinimised,
      setFullscreen,
      reset,
    }),
    [stack, active, minimised, fullscreen, openRelated, goTo, closeActive, restore, nameActiveCard, setMinimised, setFullscreen, reset],
  );
}

export type StackCardSummary = { key: string; title: string; kindLabel: string };

/**
 * The panel's dialog shell. It renders into the page's inspector column (or
 * as an overlay drawer outside the app layout), with the earlier cards of a
 * stack peeking out behind the visible one.
 */
export function RecordPanelShell({
  onEscape,
  header,
  actions,
  stackBar,
  peekCount,
  cardKey,
  fullscreen,
  footer,
  children,
}: {
  /** Esc and the inspector's own close gesture close the visible card. */
  onEscape: () => void;
  header: ReactNode;
  actions: ReactNode;
  stackBar?: ReactNode;
  peekCount: number;
  cardKey: string;
  fullscreen: boolean;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const inspector = useInspectorPanel();
  const panelId = useId();
  const titleId = `record-panel-title-${panelId.replace(/:/g, "")}`;
  const dialogRef = useDialogFocus<HTMLDivElement>(true, onEscape);

  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  useEffect(() => {
    if (!inspector) return;
    inspector.activate(panelId, () => onEscapeRef.current());
    return () => inspector.deactivate(panelId);
  }, [inspector, panelId]);

  // Moving between cards keeps keyboard focus inside the panel.
  const lastCard = useRef(cardKey);
  useEffect(() => {
    if (lastCard.current === cardKey) return;
    lastCard.current = cardKey;
    const root = dialogRef.current;
    if (!root) return;
    const active = document.activeElement;
    if (active && root.contains(active) && active !== document.body) return;
    root.focus({ preventScroll: true });
  }, [cardKey, dialogRef]);

  const peeks = Math.min(peekCount, 2);
  const panel = (
    <div
      className={
        "record-side-panel record-panel-stack" +
        (inspector?.portalTarget ? " inspector-panel" : " drawer") +
        (peeks ? ` record-panel-stack--peek-${peeks}` : "") +
        (fullscreen ? " record-side-panel--fullscreen" : "")
      }
      role="dialog"
      aria-modal={inspector?.portalTarget ? undefined : "true"}
      aria-labelledby={titleId}
      ref={dialogRef}
      tabIndex={-1}
      data-stack-depth={peekCount + 1}
    >
      {peeks > 0 && (
        <div className="record-panel-stack__peeks" aria-hidden="true">
          {Array.from({ length: peeks }).map((_, index) => (
            <span key={index} className={`record-panel-stack__peek record-panel-stack__peek--${peeks - index}`} />
          ))}
        </div>
      )}
      <div className="record-panel-stack__card" key={cardKey}>
        {stackBar}
        <div className="drawer__head inspector-panel__head record-side-panel__head">
          <div id={titleId} className="record-side-panel__title">{header}</div>
          <div className="record-side-panel__actions">{actions}</div>
        </div>
        <div className="drawer__body inspector-panel__body record-side-panel__body">{children}</div>
        {footer && <div className="drawer__footer inspector-panel__footer record-side-panel__footer">{footer}</div>}
      </div>
    </div>
  );

  if (inspector?.portalTarget) return createPortal(panel, inspector.portalTarget);
  if (inspector) return null;
  return (
    <>
      <div className="drawer-backdrop" onClick={onEscape} />
      {panel}
    </>
  );
}

/** Footer Options: copy link or id, close this card, close everything. */
export function RecordPanelOptionsMenu({
  recordId,
  canCloseCard,
  depth,
  onCloseCard,
  onCloseAll,
}: {
  /** The table record's id; null while a related card is showing. */
  recordId: string | null;
  canCloseCard: boolean;
  depth: number;
  onCloseCard: () => void;
  onCloseAll: () => void;
}) {
  return (
    <Menu
      align="left"
      minWidth={190}
      sections={[
        {
          id: "record",
          items: [
            {
              id: "copy-link",
              label: "Copy link",
              icon: <Link2 size={14} />,
              onSelect: () => void navigator.clipboard?.writeText(window.location.href),
            },
            ...(recordId
              ? [{
                  id: "copy-id",
                  label: "Copy record ID",
                  icon: <Clipboard size={14} />,
                  onSelect: () => void navigator.clipboard?.writeText(recordId),
                }]
              : []),
            ...(canCloseCard
              ? [{ id: "close-card", label: "Close this card", icon: <X size={14} />, onSelect: onCloseCard }]
              : []),
            {
              id: "close",
              label: depth > 1 ? "Close all cards" : "Close sidebar",
              icon: <X size={14} />,
              onSelect: onCloseAll,
            },
          ],
        },
      ]}
      trigger={
        <button type="button" className="btn record-side-panel__options">
          <MoreHorizontal size={14} /> Options
        </button>
      }
    />
  );
}

/** Minimise, full screen and close, in the panel header. */
export function RecordPanelActionBar({
  fullscreen,
  onMinimise,
  onToggleFullscreen,
  onClose,
  closeLabel,
}: {
  fullscreen: boolean;
  onMinimise: () => void;
  onToggleFullscreen: () => void;
  onClose: () => void;
  closeLabel: string;
}) {
  return (
    <div className="record-panel-actions" role="group" aria-label="Panel actions">
      <Tooltip content="Minimise" placement="bottom">
        <button type="button" className="btn btn--ghost btn--icon record-panel-actions__minimise" aria-label="Minimise" onClick={onMinimise}>
          <Minus size={15} />
        </button>
      </Tooltip>
      <Tooltip content={fullscreen ? "Exit full screen" : "Full screen"} placement="bottom">
        <button
          type="button"
          className="btn btn--ghost btn--icon record-panel-actions__fullscreen"
          aria-label={fullscreen ? "Exit full screen" : "Full screen"}
          aria-pressed={fullscreen}
          onClick={onToggleFullscreen}
        >
          {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      </Tooltip>
      <Tooltip content={closeLabel} placement="bottom">
        <button type="button" className="btn btn--ghost btn--icon record-panel-actions__close" aria-label={closeLabel} onClick={onClose}>
          <X size={16} />
        </button>
      </Tooltip>
    </div>
  );
}

/**
 * Back button, breadcrumb of the stacked cards, and previous/next arrows.
 * On phones only the back button and the position show.
 */
export function RecordPanelStackBar({
  cards,
  active,
  onGoTo,
}: {
  cards: StackCardSummary[];
  active: number;
  onGoTo: (index: number) => void;
}) {
  if (cards.length < 2) return null;
  const previous = active > 0 ? cards[active - 1] : null;
  return (
    <nav className="record-panel-stack__bar" aria-label="Stacked cards">
      {previous ? (
        <button
          type="button"
          className="record-panel-stack__back"
          onClick={() => onGoTo(active - 1)}
          aria-label={`Back to ${previous.title}`}
        >
          <ArrowLeft size={14} aria-hidden="true" />
          <span className="record-panel-stack__back-label">{previous.title}</span>
        </button>
      ) : null}
      <ol className="record-panel-stack__crumbs">
        {cards.map((card, index) => (
          <li key={card.key} className={index === active ? "is-current" : undefined}>
            {index === active ? (
              <span aria-current="page">{card.title}</span>
            ) : (
              <button type="button" onClick={() => onGoTo(index)} title={`${card.kindLabel}: ${card.title}`}>
                {card.title}
              </button>
            )}
          </li>
        ))}
      </ol>
      <div className="record-panel-stack__carousel">
        <span className="record-panel-stack__position" aria-live="polite">
          {active + 1} of {cards.length}
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          aria-label="Previous card"
          aria-keyshortcuts="ArrowLeft"
          disabled={active === 0}
          onClick={() => onGoTo(active - 1)}
        >
          <ChevronLeft size={15} />
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          aria-label="Next card"
          aria-keyshortcuts="ArrowRight"
          disabled={active >= cards.length - 1}
          onClick={() => onGoTo(active + 1)}
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </nav>
  );
}

/** The minimised panel: a chip at the bottom right that restores it. */
export function RecordPanelDock({
  title,
  initial,
  depth,
  onRestore,
  onClose,
}: {
  title: string;
  initial: string;
  depth: number;
  onRestore: () => void;
  onClose: () => void;
}) {
  const restoreRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Minimising moves focus to the dock so keyboard users can bring it back.
    const timer = window.setTimeout(() => restoreRef.current?.focus({ preventScroll: true }), 0);
    return () => window.clearTimeout(timer);
  }, []);
  return createPortal(
    <div className="record-panel-dock" role="region" aria-label="Minimised record panel">
      <button
        ref={restoreRef}
        type="button"
        className="record-panel-dock__restore"
        onClick={onRestore}
        aria-label={`Restore ${title}`}
      >
        <span className="record-panel-dock__avatar" aria-hidden="true">{initial}</span>
        <span className="record-panel-dock__copy">
          <strong>{title}</strong>
          {depth > 1 && <small>{depth} cards</small>}
        </span>
        <PanelRightOpen size={15} aria-hidden="true" />
      </button>
      <Tooltip content="Close" placement="top">
        <button type="button" className="record-panel-dock__close" onClick={onClose} aria-label={`Close ${title}`}>
          <X size={14} />
        </button>
      </Tooltip>
    </div>,
    document.body,
  );
}

/**
 * ←/→ move between stacked cards while focus is in the panel (or nowhere),
 * outside text fields, menus and tab lists.
 */
export function useStackArrowKeys(enabled: boolean, onBack: () => void, onForward: () => void) {
  const handlers = useRef({ onBack, onForward });
  handlers.current = { onBack, onForward };
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const fromPanel = !!target?.closest(".record-side-panel");
      const fromNowhere = !target || target === document.body || target === document.documentElement;
      if (!fromPanel && !fromNowhere) return;
      if (target?.closest('[role="menu"], [role="listbox"], [role="tablist"], .record-cell__editor, .record-table__cell-editor-popover')) return;
      event.preventDefault();
      if (event.key === "ArrowLeft") handlers.current.onBack();
      else handlers.current.onForward();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
