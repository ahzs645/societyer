import type { ReactNode } from "react";
import { ErrorBoundary } from "../ErrorBoundary";
import { HoverCard } from "./HoverCard";
import { ENTITY_KIND_LABEL, type EntityRef } from "./entityRefs";
import { EntityHoverPreview } from "./EntityPreview";

/**
 * Hover card preview for a record reference. Data loads only while the card
 * is open; see `useEntityPreview`.
 */
export function EntityHoverCard({
  entity,
  children,
  disabled,
}: {
  entity: EntityRef | null | undefined;
  children: ReactNode;
  disabled?: boolean;
}) {
  if (!entity) return <>{children}</>;
  const label = `${ENTITY_KIND_LABEL[entity.kind]} preview${entity.name ? `: ${entity.name}` : ""}`;
  return (
    <HoverCard
      label={label}
      disabled={disabled}
      className={`hover-card--entity hover-card--${entity.kind}`}
      content={() => (
        <ErrorBoundary
          label="entity-hover-card"
          fallback={<div className="entity-preview entity-preview--hover entity-preview--empty">Preview unavailable.</div>}
        >
          <EntityHoverPreview entity={entity} />
        </ErrorBoundary>
      )}
    >
      {children}
    </HoverCard>
  );
}
