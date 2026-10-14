export type PageSkeletonVariant = "table" | "detail" | "cards";

/**
 * Page-level loading placeholder: the outline of the page that is about to
 * appear (header, then a stat row and table rows, a detail layout or a card
 * grid), pulsing gently. Under reduced motion the pulse becomes a slow
 * opacity breathe.
 *
 * Screen readers hear one polite "Loading <page>…" status; the shapes are
 * hidden from assistive tech.
 */
export function PageSkeleton({
  variant = "table",
  label = "Loading…",
  className,
}: {
  variant?: PageSkeletonVariant;
  /** Visually hidden status text, e.g. "Loading Members…". */
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={`page-skeleton page-skeleton--${variant}${className ? ` ${className}` : ""}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-page-skeleton={variant}
    >
      <span className="sr-only">{label}</span>
      <div className="page-skeleton__shapes" aria-hidden="true">
        <div className="page-skeleton__header">
          <span className="page-skeleton__bone page-skeleton__icon" />
          <div className="page-skeleton__titles">
            <span className="page-skeleton__bone page-skeleton__title" />
            <span className="page-skeleton__bone page-skeleton__subtitle" />
          </div>
          <span className="page-skeleton__bone page-skeleton__action" />
        </div>
        {variant === "table" && <TableShapes />}
        {variant === "detail" && <DetailShapes />}
        {variant === "cards" && <CardShapes />}
      </div>
    </div>
  );
}

function TableShapes() {
  return (
    <>
      <div className="page-skeleton__stats">
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="page-skeleton__stat" key={index}>
            <span className="page-skeleton__bone page-skeleton__line page-skeleton__line--short" />
            <span className="page-skeleton__bone page-skeleton__figure" />
          </div>
        ))}
      </div>
      <div className="page-skeleton__table">
        <div className="page-skeleton__toolbar">
          <span className="page-skeleton__bone page-skeleton__search" />
          <span className="page-skeleton__bone page-skeleton__chip" />
          <span className="page-skeleton__bone page-skeleton__chip" />
        </div>
        {Array.from({ length: 8 }).map((_, index) => (
          <div className="page-skeleton__row" key={index}>
            <span className="page-skeleton__bone page-skeleton__line page-skeleton__cell--wide" />
            <span className="page-skeleton__bone page-skeleton__line page-skeleton__cell" />
            <span className="page-skeleton__bone page-skeleton__line page-skeleton__cell page-skeleton__cell--optional" />
            <span className="page-skeleton__bone page-skeleton__line page-skeleton__cell--narrow" />
          </div>
        ))}
      </div>
    </>
  );
}

function DetailShapes() {
  return (
    <div className="page-skeleton__detail">
      <div className="page-skeleton__panel">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="page-skeleton__field" key={index}>
            <span className="page-skeleton__bone page-skeleton__line page-skeleton__line--short" />
            <span className="page-skeleton__bone page-skeleton__line" />
          </div>
        ))}
      </div>
      <div className="page-skeleton__panel page-skeleton__panel--side">
        {Array.from({ length: 4 }).map((_, index) => (
          <span className="page-skeleton__bone page-skeleton__line" key={index} />
        ))}
      </div>
    </div>
  );
}

function CardShapes() {
  return (
    <div className="page-skeleton__cards">
      {Array.from({ length: 6 }).map((_, index) => (
        <div className="page-skeleton__panel" key={index}>
          <span className="page-skeleton__bone page-skeleton__line page-skeleton__line--short" />
          <span className="page-skeleton__bone page-skeleton__figure" />
          <span className="page-skeleton__bone page-skeleton__line" />
        </div>
      ))}
    </div>
  );
}
