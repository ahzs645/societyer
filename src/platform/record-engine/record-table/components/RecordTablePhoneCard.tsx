import { Children, Fragment, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/**
 * The standard phone card for `RecordTable`'s `renderPhoneCard`: a name, a
 * status badge and one secondary line, the whole card one tap target that
 * opens the record. Pages with richer cards (Assets) draw their own.
 */
export function RecordTablePhoneCard({
  title,
  badge,
  meta,
  onOpen,
  selecting = false,
}: {
  title: ReactNode;
  badge?: ReactNode;
  /** Secondary facts, joined with " · " on one line; empty entries are dropped. */
  meta?: ReactNode[];
  onOpen: () => void;
  /** While selecting, the card list's overlay takes taps; keep the card out of the tab order. */
  selecting?: boolean;
}) {
  const facts = Children.toArray(meta ?? []).filter((fact) => fact !== "" && fact != null);
  return (
    <button type="button" className="record-phone-card" onClick={onOpen} tabIndex={selecting ? -1 : undefined}>
      <span className="record-phone-card__title">{title}</span>
      {facts.length > 0 && (
        <span className="record-phone-card__meta">
          {facts.map((fact, index) => (
            <Fragment key={index}>
              {index > 0 && <span className="record-phone-card__dot" aria-hidden="true"> · </span>}
              <span className="record-phone-card__fact">{fact}</span>
            </Fragment>
          ))}
        </span>
      )}
      {badge ? <span className="record-phone-card__badge">{badge}</span> : null}
      <ChevronRight size={16} aria-hidden="true" className="record-phone-card__chevron" />
    </button>
  );
}
