import { useEffect, useLayoutEffect, useMemo, useState, useRef, useId } from "react";
import { createPortal } from "react-dom";
import { CalendarRange, Check, X } from "lucide-react";
import { DatePicker } from "./DatePicker";
import { bottomSheetMediaQuery } from "../lib/breakpoints";
import { useSheetDrag } from "../lib/useSheetDrag";
import { useDialogFocus } from "../lib/useDialogFocus";
import { backdropDismissProps, floatingLayerProps, isOutsidePointerEvent, swallowFollowingClick } from "../lib/floatingLayer";
import { useFloatingLayerStack } from "../lib/overlayStack";
import {
  DATE_RANGE_PRESETS,
  describeDateRange,
  formatCalendarDate,
  parseFiscalYearEnd,
  resolveDateRangePreset,
  type DateRangeContext,
  type DateRangePresetId,
  type DateRangeValue,
} from "../lib/dateRanges";

type Props = {
  value: DateRangeValue | null;
  onChange: (value: DateRangeValue | null) => void;
  /** Organisation-local today and fiscal year end, for presets. */
  context: DateRangeContext;
  placeholder?: string;
  size?: "md" | "sm";
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
};

function presetRangeHint(preset: DateRangePresetId, context: DateRangeContext) {
  const range = resolveDateRangePreset(preset, context);
  if (!range) return "";
  if (!range.start && !range.end) return "Every date";
  if (range.start === range.end && range.start) return formatCalendarDate(range.start);
  return `${range.start ? formatCalendarDate(range.start) : "…"} – ${range.end ? formatCalendarDate(range.end) : "…"}`;
}

/**
 * A date range picked from named presets (Last 30 days, Quarter to date,
 * Fiscal year to date, …) or typed as a custom start and end using the
 * regular calendar. Presets are kept by name so they stay relative.
 *
 * Desktop: an anchored popover. Phones (below 560px): a bottom sheet, like
 * the other pickers.
 */
export function DateRangePicker({
  value,
  onChange,
  context,
  placeholder = "Any time",
  size = "md",
  clearable = true,
  disabled,
  className,
  id,
  "aria-label": ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useDialogFocus<HTMLDivElement>(open, () => setOpen(false), ".date-range-picker__preset.is-selected");
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [isSheet, setIsSheet] = useState(
    () => typeof window !== "undefined" && window.matchMedia(bottomSheetMediaQuery).matches,
  );
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const headingId = useId();
  const hasFiscalYear = Boolean(parseFiscalYearEnd(context.fiscalYearEnd));
  const presets = useMemo(
    () => DATE_RANGE_PRESETS.filter((preset) => !preset.fiscal || hasFiscalYear),
    [hasFiscalYear],
  );
  // Closing by backdrop tap or swipe hands focus back to the trigger.
  const dismiss = () => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };
  useSheetDrag(panelRef, { enabled: open && isSheet, onDismiss: dismiss });
  const layer = useFloatingLayerStack(open);

  useEffect(() => {
    const media = window.matchMedia(bottomSheetMediaQuery);
    const update = () => setIsSheet(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // Opening seeds the custom fields from the current value.
  useEffect(() => {
    if (!open) return;
    setCustomStart(value?.preset && value.preset !== "custom" ? "" : value?.start ?? "");
    setCustomEnd(value?.preset && value.preset !== "custom" ? "" : value?.end ?? "");
  }, [open, value]);

  useLayoutEffect(() => {
    if (!open || isSheet) {
      setPos(null);
      return;
    }
    const place = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      const panel = panelRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = panel?.width ?? 0;
      const height = panel?.height ?? 0;
      const below = anchor.bottom + 4;
      const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, anchor.top - height - 4);
      const left = Math.min(Math.max(8, anchor.left), Math.max(8, window.innerWidth - width - 8));
      setPos((current) => (current && Math.abs(current.top - top) < 0.5 && Math.abs(current.left - left) < 0.5 ? current : { top, left }));
    };
    place();
    const frame = window.requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, isSheet, panelRef]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      // The custom-range calendars portal to <body>; they count as inside.
      if (!isOutsidePointerEvent(event, panelRef, triggerRef)) return;
      setOpen(false);
      // One tap closes one layer: not also the dialog behind the panel.
      swallowFollowingClick({ onlyBackdrops: true });
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, panelRef]);

  const choosePreset = (preset: DateRangePresetId) => {
    onChange({ preset });
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  const applyCustom = () => {
    if (!customStart && !customEnd) return;
    const [start, end] = customStart && customEnd && customStart > customEnd ? [customEnd, customStart] : [customStart, customEnd];
    onChange({ preset: "custom", ...(start ? { start } : {}), ...(end ? { end } : {}) });
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  const selectedPreset = value?.preset && value.preset !== "custom" ? value.preset : value ? "custom" : null;
  const label = value ? describeDateRange(value) : null;

  return (
    <>
      <span className={`date-trigger-wrap date-range-picker${value && clearable && !disabled ? " has-clear" : ""}${className ? ` ${className}` : ""}`}>
        <button
          ref={triggerRef}
          type="button"
          id={id}
          className={`select-trigger date-trigger${size === "sm" ? " select-trigger--sm" : ""}${open ? " is-open" : ""}`}
          onClick={() => !disabled && setOpen((current) => !current)}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={ariaLabel ? `${ariaLabel}: ${label ?? placeholder}` : undefined}
        >
          <CalendarRange size={size === "sm" ? 12 : 14} className="select-trigger__icon" aria-hidden="true" />
          <span className="select-trigger__label">
            {label ?? <span className="select-trigger__placeholder">{placeholder}</span>}
          </span>
        </button>
        {value && clearable && !disabled && (
          <button type="button" aria-label="Clear date range" className="date-trigger__clear" onClick={() => onChange(null)}>
            <X size={12} />
          </button>
        )}
      </span>
      {open
        ? createPortal(
            <>
              {isSheet && <div className="menu-backdrop" style={layer.backdrop} {...backdropDismissProps(dismiss)} />}
              <div
                ref={panelRef}
                {...floatingLayerProps}
                className={`date-range-picker__panel${isSheet ? " date-range-picker__panel--sheet" : ""}`}
                role="dialog"
                aria-modal={isSheet || undefined}
                aria-labelledby={headingId}
                tabIndex={-1}
                style={{ ...layer.panel, ...(isSheet ? null : pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }) }}
              >
                {isSheet && <div className="sheet-grabber" aria-hidden="true" />}
                <div className="date-range-picker__head" id={headingId}>Date range</div>
                <div className="date-range-picker__body">
                  <div className="date-range-picker__presets" role="group" aria-label="Presets">
                    {presets.map((preset) => {
                      const selected = selectedPreset === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          className={`date-range-picker__preset${selected ? " is-selected" : ""}`}
                          aria-pressed={selected}
                          onClick={() => choosePreset(preset.id)}
                        >
                          <span className="date-range-picker__preset-label">{preset.label}</span>
                          <span className="date-range-picker__preset-hint">{presetRangeHint(preset.id, context)}</span>
                          {selected && <Check size={13} aria-hidden="true" className="date-range-picker__preset-check" />}
                        </button>
                      );
                    })}
                    {!hasFiscalYear && (
                      <p className="date-range-picker__note">Record a fiscal year end in organization settings to filter by fiscal year.</p>
                    )}
                  </div>
                  <div className={`date-range-picker__custom${selectedPreset === "custom" ? " is-selected" : ""}`}>
                    <div className="date-range-picker__custom-title">Custom range</div>
                    <div className="date-range-picker__field">
                      <span id={`${headingId}-start`}>Start</span>
                      <DatePicker value={customStart} onChange={setCustomStart} placeholder="Any start" size="sm" max={customEnd || undefined} aria-describedby={`${headingId}-start`} />
                    </div>
                    <div className="date-range-picker__field">
                      <span id={`${headingId}-end`}>End</span>
                      <DatePicker value={customEnd} onChange={setCustomEnd} placeholder="Any end" size="sm" min={customStart || undefined} aria-describedby={`${headingId}-end`} />
                    </div>
                    <button
                      type="button"
                      className="btn btn--accent btn--sm date-range-picker__apply"
                      disabled={!customStart && !customEnd}
                      onClick={applyCustom}
                    >
                      Apply range
                    </button>
                  </div>
                </div>
              </div>
            </>,
            document.body,
          )
        : null}
    </>
  );
}
