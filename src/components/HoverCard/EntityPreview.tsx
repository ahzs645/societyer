import { Link } from "react-router-dom";
import { ArrowUpRight, Lock } from "lucide-react";
import { Money } from "../Money";
import { ENTITY_KIND_LABEL, type EntityRef } from "./entityRefs";
import { useEntityPreview, type EntityPreviewData, type EntityPreviewState } from "./useEntityPreview";
import { EntityChip } from "./EntityChip";

/** Hover-card body for one record: identity, key facts and links. */
export function EntityHoverPreview({ entity }: { entity: EntityRef }) {
  const state = useEntityPreview(entity);
  return <EntityPreviewBody entity={entity} state={state} variant="hover" />;
}

export function EntityPreviewBody({
  entity,
  state,
  variant,
}: {
  entity: EntityRef;
  state: EntityPreviewState;
  variant: "hover" | "panel";
}) {
  const data = state.data;
  if (!data) {
    if (state.status === "loading") return <EntityPreviewSkeleton variant={variant} />;
    return (
      <div className={`entity-preview entity-preview--${variant} entity-preview--empty`}>
        {state.status === "denied" && <Lock size={14} aria-hidden="true" />}
        <span>
          {state.status === "denied"
            ? `You don't have access to this ${ENTITY_KIND_LABEL[entity.kind].toLowerCase()}.`
            : `${entity.name ?? ENTITY_KIND_LABEL[entity.kind]} is no longer available.`}
        </span>
      </div>
    );
  }
  return <EntityPreviewContent data={data} variant={variant} />;
}

export function EntityPreviewContent({ data, variant }: { data: EntityPreviewData; variant: "hover" | "panel" }) {
  const isHover = variant === "hover";
  return (
    <div className={`entity-preview entity-preview--${variant}`}>
      {isHover && (
        <div className="entity-preview__head">
          {data.thumbnailUrl ? (
            <img className="entity-preview__thumb" src={data.thumbnailUrl} alt="" />
          ) : (
            <span className="entity-preview__avatar" aria-hidden="true">{data.initials}</span>
          )}
          <span className="entity-preview__identity">
            <span className="entity-preview__kind">{data.kindLabel}</span>
            <strong className="entity-preview__title">{data.title}</strong>
            {data.subtitle && <span className="entity-preview__subtitle">{data.subtitle}</span>}
          </span>
        </div>
      )}
      {!isHover && data.thumbnailUrl && (
        <img className="entity-preview__thumb entity-preview__thumb--large" src={data.thumbnailUrl} alt="" />
      )}
      {data.badges.length > 0 && (
        <div className="entity-preview__badges">
          {data.badges.map((badge) => (
            <span key={badge.label} className={`entity-preview__badge entity-preview__badge--${badge.tone}`}>
              {badge.label}
            </span>
          ))}
        </div>
      )}
      {data.facts.length > 0 && (
        <dl className="entity-preview__facts">
          {data.facts.map((fact) => (
            <div key={fact.label} className="entity-preview__fact">
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {data.activity && (
        <div className="entity-preview__activity">
          <div className="entity-preview__section-title">{data.activity.title}</div>
          <ul>
            {data.activity.rows.slice(0, isHover ? 2 : 5).map((row) => (
              <li key={row.key}>
                <span className="entity-preview__activity-copy">
                  <span>{row.primary}</span>
                  {row.secondary && <small>{row.secondary}</small>}
                </span>
                {typeof row.cents === "number" && (
                  <Money cents={row.cents} tone={row.cents >= 0 ? "in" : "out"} signDisplay="exceptZero" />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!isHover && data.related.length > 0 && (
        <div className="entity-preview__related">
          <div className="entity-preview__section-title">Linked records</div>
          <ul>
            {data.related.map((item) => (
              <li key={`${item.label}:${item.ref.kind}:${item.ref.id ?? item.ref.name}`}>
                <span className="entity-preview__related-label">{item.label}</span>
                <EntityChip entity={item.ref} label={item.ref.name} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {isHover && data.href && (
        <Link className="entity-preview__open" to={data.href} tabIndex={-1}>
          Open {data.kindLabel.toLowerCase()} <ArrowUpRight size={12} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

function EntityPreviewSkeleton({ variant }: { variant: "hover" | "panel" }) {
  return (
    <div className={`entity-preview entity-preview--${variant} entity-preview--loading`} aria-busy="true">
      <span className="sr-only">Loading preview</span>
      <div className="entity-preview__head">
        <span className="entity-preview__avatar entity-preview__shimmer" aria-hidden="true" />
        <span className="entity-preview__identity" aria-hidden="true">
          <span className="entity-preview__shimmer entity-preview__shimmer--line" />
          <span className="entity-preview__shimmer entity-preview__shimmer--short" />
        </span>
      </div>
    </div>
  );
}
