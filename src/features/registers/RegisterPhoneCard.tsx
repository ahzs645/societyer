import type { ReactNode } from "react";

/**
 * Phone card for a register with no detail view to open (Conflicts,
 * Inspections): the row reads in full, and its action stays on the card.
 * RecordTablePhoneCard is one tap target, so it would be a button that does
 * nothing here.
 */
export function RegisterPhoneCard({
  title,
  badge,
  meta,
  detail,
  action,
}: {
  title: ReactNode;
  badge?: ReactNode;
  meta?: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="register-phone-card">
      <div className="register-phone-card__head">
        <span className="register-phone-card__title">{title}</span>
        {badge ? <span className="register-phone-card__badge">{badge}</span> : null}
      </div>
      {meta ? <span className="register-phone-card__meta">{meta}</span> : null}
      {detail || action ? (
        <div className="register-phone-card__foot">
          <span className="register-phone-card__meta">{detail}</span>
          {action}
        </div>
      ) : null}
    </div>
  );
}
