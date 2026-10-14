import { Link } from "react-router-dom";
import { CalendarDays, FileText, Receipt, ReceiptText, Store, type LucideIcon } from "lucide-react";
import { ENTITY_KIND_LABEL, entityHref, type EntityRef } from "./entityRefs";
import { EntityHoverCard } from "./EntityHoverCard";
import { usePanelStack } from "./panelStackContext";
import { useEntityPreview } from "./useEntityPreview";

/** Records that are not people show what they are; people show an initial. */
const KIND_ICONS: Partial<Record<EntityRef["kind"], LucideIcon>> = {
  document: FileText,
  meeting: CalendarDays,
  counterparty: Store,
  invoice: ReceiptText,
  claim: Receipt,
};

/**
 * A linked record shown as a chip. Hovering (or keyboard focus) previews it;
 * activating it opens the record as a stacked card when inside a record
 * panel, or goes to its page elsewhere.
 */
export function EntityChip({
  entity,
  label,
  className,
}: {
  entity: EntityRef;
  /** Shown as-is; when omitted the record's title is looked up. */
  label?: string;
  className?: string;
}) {
  const stack = usePanelStack();
  const lookup = useEntityPreview(label ? null : entity);
  const text = label || lookup.data?.title || entity.name || ENTITY_KIND_LABEL[entity.kind];
  const href = entityHref(entity);
  const classes = `entity-chip entity-chip--${entity.kind}${className ? ` ${className}` : ""}`;
  const KindIcon = KIND_ICONS[entity.kind];
  const content = (
    <>
      <span className="entity-chip__avatar" aria-hidden="true">
        {KindIcon ? <KindIcon size={12} /> : text.trim().charAt(0).toUpperCase() || "?"}
      </span>
      <span className="entity-chip__label">{text}</span>
    </>
  );

  let trigger;
  if (stack) {
    trigger = (
      <button
        type="button"
        className={classes}
        aria-label={`Open ${ENTITY_KIND_LABEL[entity.kind].toLowerCase()} ${text}`}
        onClick={(event) => {
          event.stopPropagation();
          stack.openRelated({ ...entity, name: entity.name ?? text });
        }}
      >
        {content}
      </button>
    );
  } else if (href) {
    trigger = (
      <Link className={classes} to={href} onClick={(event) => event.stopPropagation()}>
        {content}
      </Link>
    );
  } else {
    trigger = <span className={classes} tabIndex={0}>{content}</span>;
  }

  return <EntityHoverCard entity={{ ...entity, name: entity.name ?? (label || undefined) }}>{trigger}</EntityHoverCard>;
}
