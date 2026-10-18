import { useId } from "react";
import { X } from "lucide-react";
import { formatRange, type DateRange } from "../../../components/charts";
import { COMPARE_CHOICES, RANGE_PRESETS, type CompareChoice, type RangePreset } from "./series";

/**
 * One filter row above the finance charts: range presets, what to compare
 * against (off, the previous period or the same period last year) and, once a
 * range is dragged on the cash chart, a chip to clear it.
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
  compare: CompareChoice;
  onCompare: (value: CompareChoice) => void;
  range: DateRange;
  selection: DateRange | null;
  onClearSelection: () => void;
  /** Shown beside the comparison toggle, e.g. when there is no earlier history. */
  compareNote?: string;
}) {
  const compareLabelId = useId();
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
      <div className="insights__compare">
        <span className="insights__compare-label" id={compareLabelId}>Compare to</span>
        <div className="segmented segmented--compact" role="group" aria-labelledby={compareLabelId}>
          {COMPARE_CHOICES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`segmented__btn${compare === item.id ? " is-active" : ""}`}
              aria-pressed={compare === item.id}
              title={item.title}
              onClick={() => onCompare(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
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
