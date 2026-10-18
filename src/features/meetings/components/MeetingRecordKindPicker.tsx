import { useId } from "react";
import { MEETING_RECORD_KIND_OPTIONS, type MeetingRecordKind } from "../../../../shared/meetingRecordKind";

/**
 * "What do you want to keep?" — just the meeting, notes, or formal minutes.
 * Native radios in a labelled radiogroup, so arrow keys move the choice and
 * screen readers announce the group, styled as compact cards.
 */
export function MeetingRecordKindPicker({
  value,
  onChange,
  disabled = false,
  hint = "Change it any time. Notes can become minutes later.",
}: {
  value: MeetingRecordKind;
  onChange: (kind: MeetingRecordKind) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  return (
    <div className="record-kind-picker">
      <div className="record-kind-picker__label" id={labelId}>What do you want to keep?</div>
      <div className="record-kind-picker__hint" id={hintId}>{hint}</div>
      <div
        className="record-kind-picker__options"
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={hintId}
      >
        {MEETING_RECORD_KIND_OPTIONS.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={`record-kind-option${selected ? " is-selected" : ""}${disabled ? " is-disabled" : ""}`}
            >
              <input
                type="radio"
                className="record-kind-option__input"
                name={`${id}-kind`}
                value={option.value}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(option.value)}
              />
              <span className="record-kind-option__title">{option.label}</span>
              <span className="record-kind-option__hint">{option.hint}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
