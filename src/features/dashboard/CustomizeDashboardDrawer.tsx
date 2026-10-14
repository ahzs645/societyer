import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowDown, ArrowLeftRight, ArrowUp, GripVertical, RotateCcw } from "lucide-react";
import { Drawer } from "../../components/ui";
import { Checkbox } from "../../components/Controls";
import {
  DASHBOARD_MODULES,
  modulePlacement,
  type DashboardColumn,
  type DashboardLayout,
  type DashboardModuleId,
  type DashboardPlacement,
} from "./dashboardLayout";

const DEFINITIONS = new Map(DASHBOARD_MODULES.map((module) => [module.id, module]));
const GROUPS: Array<{ placement: DashboardPlacement; label: string }> = [
  { placement: "full", label: "Top of the page" },
  { placement: "main", label: "Main column" },
  { placement: "side", label: "Side column" },
];
const GROUP_LABEL: Record<DashboardPlacement, string> = { full: "top of the page", main: "main column", side: "side column" };

/**
 * "Customize dashboard": show or hide each module, reorder it within its
 * column, or move it to the other column — by drag, the buttons, or the
 * keyboard on a row's handle (↑/↓ reorder, ←/→ switch column).
 */
export function CustomizeDashboardDrawer({
  open,
  onClose,
  layout,
  available,
  isDefault,
  onToggle,
  onChange,
  onReset,
}: {
  open: boolean;
  onClose: () => void;
  layout: DashboardLayout;
  /** Modules that exist for this workspace and role. */
  available: DashboardModuleId[];
  isDefault: boolean;
  onToggle: (id: DashboardModuleId, visible: boolean) => void;
  onChange: (layout: DashboardLayout) => void;
  onReset: () => void;
}) {
  const availableSet = new Set(available);
  const rowsFor = (placement: DashboardPlacement, source: DashboardLayout = layout) =>
    source.order.filter((id) => availableSet.has(id) && modulePlacement(source, id) === placement);
  const [dragging, setDragging] = useState<DashboardModuleId | null>(null);
  const [dropTarget, setDropTarget] = useState<DashboardModuleId | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const handleRefs = useRef(new Map<DashboardModuleId, HTMLButtonElement | null>());
  const refocus = (id: DashboardModuleId) => window.requestAnimationFrame(() => handleRefs.current.get(id)?.focus());
  const label = (id: DashboardModuleId) => DEFINITIONS.get(id)?.label ?? id;

  /** Moves `id` to `toIndex` among the modules of `placement` (changing column if needed). */
  const place = (id: DashboardModuleId, placement: DashboardPlacement, toIndex: number, focus = false) => {
    const from = modulePlacement(layout, id);
    if ((from === "full") !== (placement === "full")) return;
    const columns = placement === "full" ? layout.columns : { ...layout.columns, [id]: placement as DashboardColumn };
    const moved: DashboardLayout = { ...layout, columns };
    const targetRows = rowsFor(placement, moved).filter((entry) => entry !== id);
    const index = Math.max(0, Math.min(toIndex, targetRows.length));
    if (from === placement && rowsFor(placement).indexOf(id) === index) return;
    const order = layout.order.filter((entry) => entry !== id);
    const anchor = targetRows[index];
    const last = targetRows[targetRows.length - 1];
    const insertAt = anchor ? order.indexOf(anchor) : last ? order.indexOf(last) + 1 : order.length;
    order.splice(insertAt, 0, id);
    onChange({ ...moved, order });
    setAnnouncement(`${label(id)} moved to position ${index + 1} of ${targetRows.length + 1} in the ${GROUP_LABEL[placement]}.`);
    if (focus) refocus(id);
  };

  const otherColumn = (placement: DashboardPlacement): DashboardColumn => (placement === "main" ? "side" : "main");

  const onHandleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, id: DashboardModuleId) => {
    const placement = modulePlacement(layout, id);
    const index = rowsFor(placement).indexOf(id);
    if (event.key === "ArrowUp") place(id, placement, index - 1, true);
    else if (event.key === "ArrowDown") place(id, placement, index + 1, true);
    else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && placement !== "full") {
      const target = event.key === "ArrowLeft" ? "main" : "side";
      if (target !== placement) place(id, target, index, true);
    } else return;
    event.preventDefault();
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Customize dashboard"
      className="dashboard-customize"
      footer={
        <>
          <button type="button" className="btn dashboard-customize__reset" onClick={onReset} disabled={isDefault}>
            <RotateCcw size={12} /> Reset to default
          </button>
          <button type="button" className="btn btn--accent" onClick={onClose}>Done</button>
        </>
      }
    >
      <p className="muted dashboard-customize__intro">
        Choose the modules you want, then drag them into place. On a handle, ↑ and ↓ reorder and ← and → switch columns.
      </p>
      {GROUPS.map((group) => {
        const rows = rowsFor(group.placement);
        if (!rows.length && group.placement === "full") return null;
        return (
          <section key={group.placement} className="dashboard-customize__group" aria-label={group.label}>
            <h3 className="dashboard-customize__group-title">{group.label}</h3>
            <ol
              className="dashboard-customize__list"
              onDragOver={(event) => {
                if (!dragging || rows.length) return;
                event.preventDefault();
              }}
              onDrop={(event) => {
                if (!dragging || rows.length) return;
                event.preventDefault();
                place(dragging, group.placement, 0);
                setDragging(null);
              }}
            >
              {rows.length === 0 && <li className="dashboard-customize__empty muted">Drop a module here</li>}
              {rows.map((id, index) => {
                const definition = DEFINITIONS.get(id);
                if (!definition) return null;
                const visible = !layout.hidden.includes(id);
                return (
                  <li
                    key={id}
                    className={`dashboard-customize__row${dragging === id ? " is-dragging" : ""}${dropTarget === id && dragging !== id ? " is-drop-target" : ""}${visible ? "" : " is-hidden"}`}
                    onDragOver={(event) => {
                      if (!dragging) return;
                      event.preventDefault();
                      event.stopPropagation();
                      event.dataTransfer.dropEffect = "move";
                      setDropTarget(id);
                    }}
                    onDragLeave={() => setDropTarget((current) => (current === id ? null : current))}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (dragging) place(dragging, group.placement, index);
                      setDragging(null);
                      setDropTarget(null);
                    }}
                  >
                    <button
                      type="button"
                      ref={(node) => { handleRefs.current.set(id, node); }}
                      className="dashboard-customize__handle"
                      draggable
                      aria-label={`Reorder ${definition.label}, position ${index + 1} of ${rows.length} in the ${GROUP_LABEL[group.placement]}`}
                      aria-describedby="dashboard-customize-handle-hint"
                      onKeyDown={(event) => onHandleKeyDown(event, id)}
                      onDragStart={(event) => {
                        setDragging(id);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", id);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setDropTarget(null);
                      }}
                    >
                      <GripVertical size={14} aria-hidden="true" />
                    </button>
                    <div className="dashboard-customize__main">
                      <Checkbox checked={visible} onChange={(checked) => onToggle(id, checked)} label={definition.label} hint={definition.description} />
                    </div>
                    <div className="dashboard-customize__moves">
                      <button type="button" className="btn-action btn-action--icon" aria-label={`Move ${definition.label} up`} disabled={index === 0} onClick={() => place(id, group.placement, index - 1)}>
                        <ArrowUp size={14} />
                      </button>
                      <button type="button" className="btn-action btn-action--icon" aria-label={`Move ${definition.label} down`} disabled={index === rows.length - 1} onClick={() => place(id, group.placement, index + 1)}>
                        <ArrowDown size={14} />
                      </button>
                      {group.placement !== "full" && (
                        <button
                          type="button"
                          className="btn-action btn-action--icon"
                          aria-label={`Move ${definition.label} to the ${GROUP_LABEL[otherColumn(group.placement)]}`}
                          title={`Move to the ${GROUP_LABEL[otherColumn(group.placement)]}`}
                          onClick={() => place(id, otherColumn(group.placement), rowsFor(otherColumn(group.placement)).length)}
                        >
                          <ArrowLeftRight size={14} />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
      <span id="dashboard-customize-handle-hint" className="sr-only">Up and down arrows reorder; left and right arrows switch columns.</span>
      <div className="sr-only" aria-live="polite">{announcement}</div>
    </Drawer>
  );
}
