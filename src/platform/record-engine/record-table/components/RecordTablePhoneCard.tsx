import { Children, Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useRecordTableCardActions, type RecordTableCardActionsValue } from "../contexts/RecordTableCardActionsContext";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { recordTitleText } from "../utils/recordTitle";
import { PinnedRowActionsMenu, collectRowActionItems } from "./RecordTableRow";

/**
 * The standard phone card for `RecordTable`'s `renderPhoneCard`: a name, a
 * status badge and one secondary line, the whole card one tap target that
 * opens the record. Pages with richer cards (Assets) draw their own.
 *
 * Inside the card list it also offers the table row's actions
 * (`renderRowActions`, `rowMenuSections`) behind a "…" button in the
 * chevron's place, so deleting a meeting works on a phone as on a row.
 */
export function RecordTablePhoneCard({
  title,
  badge,
  meta,
  onOpen,
  selecting = false,
  recordName,
  variant = "page",
  detail,
  wrapTitle = false,
}: {
  title: ReactNode;
  badge?: ReactNode;
  /** Secondary facts, joined with " · " on one line; empty entries are dropped. */
  meta?: ReactNode[];
  /** Leave out for records with no detail view: the card reads as text, with no chevron. */
  onOpen?: () => void;
  /** While selecting, the card list's overlay takes taps; keep the card out of the tab order. */
  selecting?: boolean;
  /** Names the actions menu ("Row actions for <name>"); defaults to a string title, else the record's title field. */
  recordName?: string;
  /** "auto": RecordTable's generated card, whose long titles wrap to two lines. */
  variant?: "page" | "auto";
  /** A second, quieter meta line (who, attachments), joined the same way, for records whose first line is full. */
  detail?: ReactNode[];
  /** Long titles wrap to two lines before the ellipsis (notice and document names). */
  wrapTitle?: boolean;
}) {
  const facts = Children.toArray(meta ?? []).filter((fact) => fact !== "" && fact != null);
  const details = Children.toArray(detail ?? []).filter((fact) => fact !== "" && fact != null);
  const line = (items: ReactNode[], className: string) => (
    <span className={className}>
      {items.map((fact, index) => (
        <Fragment key={index}>
          {index > 0 && <span className="record-phone-card__dot" aria-hidden="true"> · </span>}
          <span className="record-phone-card__fact">{fact}</span>
        </Fragment>
      ))}
    </span>
  );
  const body = (
    <>
      <span className="record-phone-card__title">{title}</span>
      {facts.length > 0 && line(facts, "record-phone-card__meta")}
      {details.length > 0 && line(details, "record-phone-card__meta record-phone-card__meta--detail")}
      {badge ? <span className="record-phone-card__badge">{badge}</span> : null}
      {onOpen && <ChevronRight size={16} aria-hidden="true" className="record-phone-card__chevron" />}
    </>
  );
  const cardClass = ["record-phone-card", wrapTitle && "record-phone-card--wrap-title", details.length > 0 && "record-phone-card--detail"].filter(Boolean).join(" ");
  const card = onOpen ? (
    <button type="button" className={cardClass} onClick={onOpen} tabIndex={selecting ? -1 : undefined}>{body}</button>
  ) : (
    <div className={cardClass}>{body}</div>
  );
  const actions = useRecordTableCardActions();
  if (!actions) return card;
  return (
    <RecordTablePhoneCardActions
      card={card}
      record={actions.record}
      title={title}
      recordName={recordName}
      renderRowActions={actions.renderRowActions}
      rowMenuSections={actions.rowMenuSections}
      selecting={selecting}
      variant={variant}
    />
  );
}

function RecordTablePhoneCardActions({
  card,
  record,
  title,
  recordName,
  renderRowActions,
  rowMenuSections,
  selecting,
  variant,
}: {
  card: ReactNode;
  record: Record<string, unknown>;
  title: ReactNode;
  recordName?: string;
  renderRowActions?: RecordTableCardActionsValue["renderRowActions"];
  rowMenuSections?: RecordTableCardActionsValue["rowMenuSections"];
  selecting: boolean;
  variant: "page" | "auto";
}) {
  const { objectMetadata } = useRecordTableContextOrThrow();
  const actionsSourceRef = useRef<HTMLDivElement>(null);
  const name = recordName
    ?? (typeof title === "string" && title ? title : null)
    ?? recordTitleText(record, objectMetadata.labelIdentifierFieldName)
    ?? `this ${objectMetadata.labelSingular.toLowerCase()}`;

  const rowActions = renderRowActions?.(record);
  // A page's renderRowActions may draw nothing for some records.
  const [inlineActionCount, setInlineActionCount] = useState(0);
  useLayoutEffect(() => {
    setInlineActionCount(actionsSourceRef.current?.querySelectorAll("button, a[href]").length ?? 0);
  }, [rowActions]);
  const hasActions = inlineActionCount > 0 || !!rowMenuSections;
  const className = [
    "record-phone-card-shell",
    variant === "auto" ? "record-phone-card-shell--auto" : "",
    hasActions ? "has-actions" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={className}>
      {card}
      {/* The page's inline actions stay rendered (hidden) so the menu runs
          their own click handlers, as the table's pinned actions do. */}
      {rowActions != null && (
        <div ref={actionsSourceRef} hidden>
          {rowActions}
        </div>
      )}
      {hasActions && (
        <div className="record-phone-card__actions">
          <PinnedRowActionsMenu
            recordName={name}
            triggerClassName="record-phone-card__actions-button"
            disabled={selecting}
            getSections={() =>
              [
                {
                  id: "row-actions",
                  // The menu is titled with the record: "Mark deadline as
                  // closed", not "Mark deadline File annual report as closed".
                  items: collectRowActionItems(actionsSourceRef.current, name).map((item) => ({
                    ...item,
                    label: typeof item.label === "string" ? item.label.replace(` ${name} `, " ") : item.label,
                  })),
                },
                ...(rowMenuSections?.(record) ?? []),
              ].filter((section) => section.items.length > 0)
            }
          />
        </div>
      )}
    </div>
  );
}
