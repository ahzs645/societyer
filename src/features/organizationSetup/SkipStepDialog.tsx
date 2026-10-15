import { useEffect, useId, useState } from "react";
import type { SetupStepView } from "../../../shared/organizationSetup/types";
import { Drawer } from "../../components/ui";
import { NOT_APPLICABLE_REASONS } from "./setupCopy";

const OTHER = "__other__";
const MAX_REASON = 300;

/** "Doesn't apply to us": pick a preset reason or write one (a sheet on phones). */
export function SkipStepDialog({
  step,
  onClose,
  onSave,
}: {
  step: SetupStepView | null;
  onClose: () => void;
  onSave: (reason: string) => Promise<void>;
}) {
  const [choice, setChoice] = useState<string>("");
  const [other, setOther] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const name = useId();
  const otherId = useId();
  const errorId = useId();

  useEffect(() => {
    if (!step) return;
    setChoice("");
    setOther("");
    setError(null);
    setSaving(false);
  }, [step]);

  const reason = choice === OTHER ? other.trim() : choice;
  const save = async () => {
    if (!reason) {
      setError(choice === OTHER ? "Write a short reason." : "Choose a reason.");
      return;
    }
    setSaving(true);
    try {
      await onSave(reason);
    } catch (err: any) {
      setError(err?.message ?? "This couldn't be saved.");
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={Boolean(step)}
      onClose={onClose}
      title="Doesn't apply to us"
      className="setup-sheet"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn--accent" disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      {step && (
        <form className="setup-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <p className="setup-form__lead">
            <strong>{step.title}</strong> will stay on the list, crossed out with your reason. You can undo this any time.
          </p>
          <fieldset className="setup-form__choices" aria-describedby={error ? errorId : undefined}>
            <legend className="setup-form__legend">Why doesn't it apply?</legend>
            {[...NOT_APPLICABLE_REASONS, OTHER].map((value) => (
              <label key={value} className={`setup-choice${choice === value ? " is-checked" : ""}`}>
                <input
                  type="radio"
                  name={name}
                  value={value}
                  checked={choice === value}
                  onChange={() => { setChoice(value); setError(null); }}
                />
                <span>{value === OTHER ? "Another reason" : value}</span>
              </label>
            ))}
          </fieldset>
          {choice === OTHER && (
            <div className="field">
              <label className="field__label" htmlFor={otherId}>Reason</label>
              <textarea
                id={otherId}
                className="input"
                rows={3}
                maxLength={MAX_REASON}
                value={other}
                autoFocus
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={error ? errorId : undefined}
                onChange={(event) => { setOther(event.target.value); setError(null); }}
              />
            </div>
          )}
          {error && <p className="field__error" id={errorId} role="alert">{error}</p>}
        </form>
      )}
    </Drawer>
  );
}
