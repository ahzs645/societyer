import { X } from "lucide-react";
import { formatRange, type DateRange } from "../../../components/charts";
import { RANGE_PRESETS, type RangePreset } from "./series";

/**
 * One filter row above the finance charts: range presets, the previous-period
 * comparison and, once a range is dragged on the cash chart, a chip to clear it.
 */
export function FinanceRangeBar({
  preset,
  onPreset,
  compare,
  onCompare,
  range,
  selection,
  onClearSelection,
  compareNote,
}: {
  preset: RangePreset;
  onPreset: (preset: RangePreset) => void;
  compare: boolean;
  onCompare: (value: boolean) => void;
  range: DateRange;
  selection: DateRange | null;
  onClearSelection: () => void;
  /** Shown beside the comparison toggle, e.g. when there is no earlier history. */
  compareNote?: string;
}) {
  return (
    <div className="insights__filters">
      <div className="segmented segmented--compact" role="group" aria-label="Date range">
        {RANGE_PRESETS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`segmented__btn${preset === item.id ? " is-active" : ""}`}
            aria-pressed={preset === item.id}
            title={item.title}
            onClick={() => onPreset(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <button type="button" className="insights__chip" aria-pressed={compare} onClick={() => onCompare(!compare)}>
        Compare to previous period
      </button>
      {compareNote && <span className="insights__range-label insights__range-label--muted">{compareNote}</span>}
      {selection ? (
        <button type="button" className="insights__chip" aria-pressed="true" onClick={onClearSelection} aria-label={`Clear selected range ${formatRange(selection.start, selection.end)}`}>
          {formatRange(selection.start, selection.end)}
          <X size={12} aria-hidden="true" />
        </button>
      ) : (
        <span className="insights__range-label">{formatRange(range.start, range.end)}</span>
      )}
    </div>
  );
}
