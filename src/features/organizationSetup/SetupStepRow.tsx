import { useId, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, Circle, CircleDashed, Clock, Lock, MinusCircle, MoreHorizontal, Undo2 } from "lucide-react";
import type { SetupStepState, SetupStepView } from "../../../shared/organizationSetup/types";
import { Menu, type MenuItem } from "../../components/Menu";
import { STEP_STATE_LABEL, canDecideStep, isLifecycleStep } from "./setupCopy";
import { SetupStepActions } from "./SetupStepActions";
import { useSetupView } from "./SetupViewContext";

const STATE_ICON: Record<SetupStepState, ReactNode> = {
  done: <CheckCircle2 size={18} />,
  in_progress: <CircleDashed size={18} />,
  todo: <Circle size={18} />,
  later: <Clock size={18} />,
  not_applicable: <MinusCircle size={18} />,
  restricted: <Lock size={16} />,
};

export function SetupStepIcon({ state }: { state: SetupStepState }) {
  return <span className={`setup-step__icon setup-step__icon--${state}`} aria-hidden="true">{STATE_ICON[state]}</span>;
}

/** "Remind me later", "Doesn't apply to us…" and their undo, for one step. */
export function useStepMenuItems(step: SetupStepView): MenuItem[] {
  const view = useSetupView();
  if (!view.canWrite || !canDecideStep(step)) return [];
  if (step.state === "later") {
    return [{ id: "undo-later", label: "Undo “Remind me later”", icon: <Undo2 size={14} />, onSelect: () => view.decide(step, null) }];
  }
  if (step.state === "not_applicable") {
    return [{ id: "undo-na", label: "Undo — this applies to us", icon: <Undo2 size={14} />, onSelect: () => view.decide(step, null) }];
  }
  const items: MenuItem[] = [];
  if (!isLifecycleStep(step)) items.push({ id: "later", label: "Remind me later", icon: <Clock size={14} />, onSelect: () => view.decide(step, "later") });
  if (step.allowNotApplicable) items.push({ id: "na", label: "Doesn't apply to us…", icon: <MinusCircle size={14} />, onSelect: () => view.openSkip(step) });
  return items;
}

export function StepOverflowMenu({ step }: { step: SetupStepView }) {
  const items = useStepMenuItems(step);
  if (items.length === 0) return null;
  return (
    <Menu
      align="right"
      trigger={
        <button type="button" className="btn btn--ghost btn--icon setup-step__more" aria-label={`More options for ${step.title}`}>
          <MoreHorizontal size={16} />
        </button>
      }
      sections={[{ id: "step", items }]}
    />
  );
}

/**
 * One setup step: a disclosure row (state icon, title, state) that expands to
 * the one-sentence description, any status note and the step's actions.
 */
export function SetupStepRow({
  step,
  open,
  isNext,
  onToggle,
}: {
  step: SetupStepView;
  open: boolean;
  isNext: boolean;
  onToggle: () => void;
}) {
  const bodyId = useId();
  const struck = step.state === "not_applicable";
  const stateLabel = step.state === "in_progress" && step.optional ? "In progress" : STEP_STATE_LABEL[step.state];
  return (
    <li
      id={`step-${step.key}`}
      className={`setup-step setup-step--${step.state}${open ? " is-open" : ""}${isNext ? " is-next" : ""}`}
      data-step={step.key}
    >
      <div className="setup-step__head">
        <button type="button" className="setup-step__toggle" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
          <SetupStepIcon state={step.state} />
          <span className="setup-step__text">
            <span className={`setup-step__title${struck ? " is-struck" : ""}`}>{step.title}</span>
            {step.optional && <span className="setup-step__optional">Optional</span>}
          </span>
          <span className={`setup-step__state setup-step__state--${step.state}`}>
            {isNext && step.state !== "done" ? "Next" : stateLabel}
          </span>
          <ChevronDown size={16} className="setup-step__chevron" aria-hidden="true" />
        </button>
        <StepOverflowMenu step={step} />
      </div>
      {struck && step.note && !open && <p className="setup-step__reason">{step.note}</p>}
      <div className="setup-step__body" id={bodyId} hidden={!open}>
        <p className="setup-step__description">{step.description}</p>
        {step.note && (
          <p className={`setup-step__note${struck ? " setup-step__note--reason" : ""}`}>
            {struck ? <>Doesn't apply: {step.note}</> : step.note}
          </p>
        )}
        {step.state === "later" && <p className="setup-step__note">You asked to be reminded later. It still counts toward setup.</p>}
        {!struck && <SetupStepActions step={step} context="row" />}
      </div>
    </li>
  );
}
