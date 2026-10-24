import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarClock,
  Clock3,
  ExternalLink,
  Home,
  Pencil,
  StickyNote,
} from "lucide-react";
import { ErrorBoundary } from "../../../../components/ErrorBoundary";
import { EntityChip } from "../../../../components/HoverCard/EntityChip";
import { EntityPreviewBody } from "../../../../components/HoverCard/EntityPreview";
import { PanelStackContext } from "../../../../components/HoverCard/panelStackContext";
import { useEntityPreview } from "../../../../components/HoverCard/useEntityPreview";
import {
  ENTITY_KIND_LABEL,
  entityHref,
  entityKey,
  entityKindForObject,
  fieldEntityRef,
  linkedEntitiesForRecord,
} from "../../../../components/HoverCard/entityRefs";
import { useIsMobile } from "../../../../lib/useIsMobile";
import { FieldDisplay } from "../../record-field/components/FieldDisplay";
import { FieldInput, isFieldEditable } from "../../record-field/components/FieldInput";
import { resolveFieldIcon } from "../../record-field/fieldIcons";
import type { FieldMetadata, ObjectMetadata } from "../../types";
import type { RecordTableContextValue } from "../contexts/RecordTableContext";
import { useRecordTableState } from "../state/recordTableStore";
import { recordPersonName, recordTitleText } from "../utils/recordTitle";
import { RecordTableFloatingCellEditor } from "./RecordTableCell";
import {
  RecordPanelActionBar,
  RecordPanelDock,
  RecordPanelOptionsMenu,
  RecordPanelShell,
  RecordPanelStackBar,
  useStackArrowKeys,
  type RecordPanelStack,
  type StackCardSummary,
} from "./RecordTableSidePanelStack";
import { Tooltip } from "../../../../components/Tooltip";

type PanelTab = "home" | "timeline" | "notes";

/**
 * The record preview panel. Related records opened from it (linked records,
 * relation and person chips) stack on top as cards; the panel can be
 * minimised to a dock chip or expanded to full screen.
 */
export function RecordTableSidePanel({
  record,
  objectMetadata,
  onClose,
  onOpenRecord,
  onUpdate,
  stack,
}: {
  record: any;
  objectMetadata: ObjectMetadata;
  /** Closes the whole panel (every stacked card). */
  onClose: () => void;
  /** Omitted when the record has no fuller surface to open. */
  onOpenRecord?: () => void;
  onUpdate?: RecordTableContextValue["onUpdate"];
  /** Card stack state; RecordTableScope owns it so the URL can follow it. */
  stack: RecordPanelStack;
}) {
  const [activeTab, setActiveTab] = useState<PanelTab>("home");
  const navigate = useNavigate();
  const columns = useRecordTableState((state) => state.columns);
  const labelIdentifierFieldName = objectMetadata.labelIdentifierFieldName ?? "name";
  const visibleFields = useMemo(
    () =>
      columns
        .filter((column) => column.isVisible)
        .filter((column) => column.field.name !== labelIdentifierFieldName),
    [columns, labelIdentifierFieldName],
  );
  // People records keep their name in first/last name fields; without them
  // the panel and its minimised dock read only "Member" (or just "Ada").
  const personName = recordPersonName(record);
  const title = String(
    recordTitleText(record, labelIdentifierFieldName) ??
      record?.[labelIdentifierFieldName] ??
      record?.name ??
      record?.title ??
      record?.displayName ??
      record?.fullName ??
      personName ??
      objectMetadata.labelSingular,
  );
  const initial = title.trim().charAt(0).toUpperCase() || objectMetadata.labelSingular.charAt(0);
  const recordId = String(record?._id ?? "");
  const selfKind = entityKindForObject(objectMetadata.nameSingular);
  const visibleFieldNames = useMemo(
    () => new Set(visibleFields.map((column) => column.field.name)),
    [visibleFields],
  );
  const linkedRecords = useMemo(
    () => linkedEntitiesForRecord(record, { selfKind, skipFields: visibleFieldNames }),
    [record, selfKind, visibleFieldNames],
  );

  const activeEntity = stack.activeEntity;
  const entityPreview = useEntityPreview(activeEntity);
  const entityData = entityPreview.data;
  const entityTitle = activeEntity
    ? entityData?.title ?? activeEntity.name ?? ENTITY_KIND_LABEL[activeEntity.kind]
    : null;
  const entityPage = activeEntity ? entityData?.href ?? entityHref(activeEntity) : null;
  const openEntityPage = useMemo(
    () => (entityPage ? () => navigate(entityPage) : undefined),
    [entityPage, navigate],
  );
  const openActive = activeEntity ? openEntityPage : onOpenRecord;

  // Cards opened from a link carry no name; keep the resolved title so the
  // breadcrumb and the dock can show it once the card is out of view.
  const { nameActiveCard } = stack;
  const resolvedTitle = entityPreview.status === "ready" ? entityData?.title : undefined;
  useEffect(() => {
    // Only id cards: a name-only card's name is what it looks up.
    if (activeEntity?.id && resolvedTitle && activeEntity.name !== resolvedTitle) nameActiveCard(resolvedTitle);
  }, [activeEntity, resolvedTitle, nameActiveCard]);

  useEffect(() => {
    setActiveTab("home");
  }, [recordId]);

  useEffect(() => {
    if (stack.minimised || !openActive) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
      const target = event.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
      event.preventDefault();
      openActive();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [stack.minimised, openActive]);

  useStackArrowKeys(!stack.minimised && stack.depth > 1, stack.back, stack.forward);

  const { closeActive, reset } = stack;
  const closeVisibleCard = useCallback(() => {
    if (!closeActive()) onClose();
  }, [closeActive, onClose]);
  const closeAll = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const panelStackContext = useMemo(() => ({ openRelated: stack.openRelated }), [stack.openRelated]);

  const cards: StackCardSummary[] = [
    { key: `base:${recordId}`, title, kindLabel: objectMetadata.labelSingular },
    ...stack.stack.map((ref, index) => ({
      key: `${index}:${entityKey(ref)}`,
      title:
        index === stack.active - 1 && entityTitle
          ? entityTitle
          : ref.name ?? ENTITY_KIND_LABEL[ref.kind],
      kindLabel: ENTITY_KIND_LABEL[ref.kind],
    })),
  ];
  const visibleTitle = cards[stack.active]?.title ?? title;

  if (stack.minimised) {
    return (
      <RecordPanelDock
        title={visibleTitle}
        initial={visibleTitle.trim().charAt(0).toUpperCase() || initial}
        depth={stack.depth}
        onRestore={() => stack.setMinimised(false)}
        onClose={closeAll}
      />
    );
  }

  const optionsMenu = (
    <RecordPanelOptionsMenu
      recordId={activeEntity ? null : recordId}
      canCloseCard={stack.active > 0}
      depth={stack.depth}
      onCloseCard={closeVisibleCard}
      onCloseAll={closeAll}
    />
  );

  const header = activeEntity ? (
    <div className="record-side-panel__identity">
      <span className="record-side-panel__avatar record-side-panel__avatar--entity" aria-hidden="true">
        {entityData?.initials ?? (entityTitle ?? "?").charAt(0).toUpperCase()}
      </span>
      <span className="record-side-panel__identity-copy">
        <strong>{entityTitle}</strong>
        <small>{entityHeaderSubtitle(ENTITY_KIND_LABEL[activeEntity.kind], entityData?.subtitle)}</small>
      </span>
    </div>
  ) : (
    <div className="record-side-panel__identity">
      <span className="record-side-panel__avatar" aria-hidden="true">{initial}</span>
      <span className="record-side-panel__identity-copy">
        <strong>{title}</strong>
        <small>{recordSubtitle(record, objectMetadata.labelSingular)}</small>
      </span>
    </div>
  );

  return (
    <RecordPanelShell
      onEscape={closeVisibleCard}
      header={header}
      cardKey={cards[stack.active]?.key ?? recordId}
      peekCount={stack.active}
      fullscreen={stack.fullscreen}
      stackBar={<RecordPanelStackBar cards={cards} active={stack.active} onGoTo={stack.goTo} />}
      actions={
        <RecordPanelActionBar
          fullscreen={stack.fullscreen}
          onMinimise={() => stack.setMinimised(true)}
          onToggleFullscreen={() => stack.setFullscreen(!stack.fullscreen)}
          onClose={closeVisibleCard}
          closeLabel={stack.active > 0 ? "Close card" : "Close"}
        />
      }
      footer={
        <>
          {optionsMenu}
          {openActive && (
            <button
              type="button"
              className="btn btn--accent record-side-panel__open"
              onClick={openActive}
            >
              <ExternalLink size={14} />
              <span>{activeEntity ? "Open page" : "Open"}</span>
              <kbd>⌘↵</kbd>
            </button>
          )}
        </>
      }
    >
      <PanelStackContext.Provider value={panelStackContext}>
        {activeEntity ? (
          <section
            className="record-side-panel__widget record-side-panel__widget--entity"
            aria-label={`${ENTITY_KIND_LABEL[activeEntity.kind]} details`}
          >
            <ErrorBoundary
              label="record-panel-entity"
              resetKey={entityKey(activeEntity)}
              fallback={<div className="entity-preview entity-preview--panel entity-preview--empty">This record can't be shown here.</div>}
            >
              <EntityPreviewBody entity={activeEntity} state={entityPreview} variant="panel" />
            </ErrorBoundary>
          </section>
        ) : (
          <>
            <nav className="record-side-panel__tabs" aria-label="Record sidebar tabs">
              <PanelTabButton active={activeTab === "home"} onClick={() => setActiveTab("home")}>
                <Home size={15} /> Home
              </PanelTabButton>
              <PanelTabButton active={activeTab === "timeline"} onClick={() => setActiveTab("timeline")}>
                <Clock3 size={15} /> Timeline
              </PanelTabButton>
              <PanelTabButton active={activeTab === "notes"} onClick={() => setActiveTab("notes")}>
                <StickyNote size={15} /> Notes
              </PanelTabButton>
            </nav>

            {activeTab === "home" && (
              <section className="record-side-panel__widget" aria-labelledby="record-side-panel-fields">
                <h3 id="record-side-panel-fields">Fields</h3>
                <div className="record-side-panel__group-title">General</div>
                <div className="record-side-panel__fields">
                  {visibleFields.map((column) => (
                    <SidePanelField
                      key={column.viewFieldId}
                      field={column.field}
                      record={record}
                      recordId={recordId}
                      onUpdate={onUpdate}
                    />
                  ))}
                </div>
              </section>
            )}

            {activeTab === "home" && linkedRecords.length > 0 && (
              <section className="record-side-panel__widget" aria-labelledby="record-side-panel-linked">
                <h3 id="record-side-panel-linked">Linked records</h3>
                <ul className="record-side-panel__linked">
                  {linkedRecords.map((item) => (
                    <li key={`${item.fieldName}:${entityKey(item.ref)}`}>
                      <span className="record-side-panel__linked-label">{item.label}</span>
                      <EntityChip entity={item.ref} label={item.ref.name} />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {activeTab === "timeline" && (
              <section className="record-side-panel__widget" aria-labelledby="record-side-panel-timeline">
                <h3 id="record-side-panel-timeline">Timeline</h3>
                <div className="record-side-panel__timeline">
                  <TimelineItem
                    icon={<CalendarClock size={15} />}
                    label={timelineLabel(record)}
                  />
                  <TimelineItem
                    icon={<Clock3 size={15} />}
                    label={`Opened in the ${objectMetadata.labelSingular.toLowerCase()} sidebar`}
                  />
                </div>
              </section>
            )}

            {activeTab === "notes" && (
              <section className="record-side-panel__widget" aria-labelledby="record-side-panel-notes">
                <h3 id="record-side-panel-notes">Notes</h3>
                <div className="record-side-panel__notes">
                  {record?.notes ? String(record.notes) : "No notes have been added to this record."}
                </div>
              </section>
            )}
          </>
        )}
      </PanelStackContext.Provider>
    </RecordPanelShell>
  );
}

/** "Meeting · AGM", or just the subtitle when it already names the kind. */
function entityHeaderSubtitle(kindLabel: string, subtitle?: string) {
  if (!subtitle) return kindLabel;
  return subtitle.toLowerCase().includes(kindLabel.toLowerCase()) ? subtitle : `${kindLabel} · ${subtitle}`;
}

function SidePanelField({
  field,
  record,
  recordId,
  onUpdate,
}: {
  field: FieldMetadata;
  record: any;
  recordId: string;
  onUpdate?: RecordTableContextValue["onUpdate"];
}) {
  const [isEditing, setIsEditing] = useState(false);
  const valueAnchorRef = useRef<HTMLSpanElement>(null);
  const FieldIcon = resolveFieldIcon(field);
  const isMobile = useIsMobile();
  const canEdit = isFieldEditable(field) && !!onUpdate;
  const value = record?.[field.name];
  const entityRef = useMemo(
    () => fieldEntityRef(field, record?.[field.name], record?.[`${field.name}Label`]),
    [field, record],
  );

  useEffect(() => setIsEditing(false), [recordId, field.name]);

  const startEdit = () => {
    if (canEdit) setIsEditing(true);
  };

  const commitEdit = async (nextValue: unknown) => {
    setIsEditing(false);
    if (!canEdit) return;
    if (Object.is(nextValue, value)) return;
    await onUpdate?.({ recordId, fieldName: field.name, value: nextValue });
  };

  // On phones the floating editor (fixed-position, anchored via
  // getBoundingClientRect) drifts away from the row when the on-screen
  // keyboard pans the viewport. Render the editor inline in the value slot
  // instead, so it always sits exactly where the value is displayed.
  if (isMobile && isEditing && canEdit) {
    return (
      <div className="record-side-panel__field record-side-panel__field--editing">
        <span className="record-side-panel__field-icon" aria-hidden="true">
          <FieldIcon size={16} />
        </span>
        <span className="record-side-panel__field-label">{field.label}</span>
        <span
          className="record-side-panel__field-value record-side-panel__field-value--editing"
          data-record-cell-editor-anchor
        >
          <FieldInput
            value={value}
            field={field}
            onCommit={commitEdit}
            onCancel={() => setIsEditing(false)}
          />
        </span>
        <span aria-hidden="true" />
      </div>
    );
  }

  return (
    <div
      className={`record-side-panel__field${canEdit ? " record-side-panel__field--editable" : ""}`}
      onDoubleClick={startEdit}
    >
      <span className="record-side-panel__field-icon" aria-hidden="true">
        <FieldIcon size={16} />
      </span>
      <span className="record-side-panel__field-label">{field.label}</span>
      <span
        ref={valueAnchorRef}
        className="record-side-panel__field-value"
        tabIndex={canEdit && !entityRef ? 0 : undefined}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || !canEdit || event.target !== event.currentTarget) return;
          event.preventDefault();
          startEdit();
        }}
      >
        {entityRef ? (
          <EntityChip entity={entityRef} label={entityRef.name} />
        ) : (
          <FieldDisplay value={value} record={record} field={field} />
        )}
      </span>
      {canEdit ? (
        <Tooltip content={`Edit ${field.label}`}>
          <button
            type="button"
            className="record-side-panel__field-edit"
            aria-label={`Edit ${field.label}`}
            onClick={startEdit}
          >
            <Pencil size={12} />
          </button>
        </Tooltip>
      ) : (
        <span aria-hidden="true" />
      )}
      {isEditing && canEdit ? (
        <RecordTableFloatingCellEditor
          anchorRef={valueAnchorRef}
          value={value}
          field={field}
          onCommit={commitEdit}
          onCancel={() => setIsEditing(false)}
        />
      ) : null}
    </div>
  );
}

function PanelTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={active ? "is-active" : ""}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function TimelineItem({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="record-side-panel__timeline-item">
      <span aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </div>
  );
}

function recordSubtitle(record: any, fallback: string) {
  if (record?.scheduledAt) return `Scheduled ${formatPanelDate(record.scheduledAt)}`;
  if (record?.createdAt || record?._creationTime) {
    return `Created ${formatPanelDate(record.createdAt ?? record._creationTime)}`;
  }
  return `${fallback} record`;
}

function timelineLabel(record: any) {
  if (record?.scheduledAt) return `Scheduled for ${formatPanelDate(record.scheduledAt)}`;
  if (record?.createdAt || record?._creationTime) {
    return `Created ${formatPanelDate(record.createdAt ?? record._creationTime)}`;
  }
  return "Record available in this view";
}

function formatPanelDate(value: unknown) {
  const date = new Date(value as any);
  if (Number.isNaN(date.getTime())) return String(value ?? "");
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
