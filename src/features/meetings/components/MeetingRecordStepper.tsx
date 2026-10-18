import { Check } from "lucide-react";
import type { MeetingRecordStep } from "../../../../shared/meetingRecordKind";

/** "Transcript ✓ · Notes ✓ · Minutes draft · Approved", computed from real state. */
export function MeetingRecordStepper({ steps }: { steps: MeetingRecordStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="record-stepper" aria-label="Meeting record progress">
      {steps.map((step, index) => (
        <li
          key={step.id}
          className={`record-stepper__step is-${step.state}`}
          aria-current={step.state === "current" ? "step" : undefined}
        >
          <span className="record-stepper__mark" aria-hidden="true">
            {step.state === "done" ? <Check size={11} strokeWidth={3} /> : index + 1}
          </span>
          <span className="record-stepper__label">{step.label}</span>
          {step.state === "done" && <span className="sr-only"> (done)</span>}
        </li>
      ))}
    </ol>
  );
}
