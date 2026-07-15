import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CalendarClock,
  Clipboard,
  Clock3,
  ExternalLink,
  Home,
  MoreHorizontal,
  Pencil,
  StickyNote,
  X,
} from "lucide-react";
import { Drawer } from "../../../../components/ui";
import { Menu } from "../../../../components/Menu";
import { FieldDisplay } from "../../record-field/components/FieldDisplay";
import { isFieldEditable } from "../../record-field/components/FieldInput";
import { resolveFieldIcon } from "../../record-field/fieldIcons";
import type { FieldMetadata, ObjectMetadata } from "../../types";
import type { RecordTableContextValue } from "../contexts/RecordTableContext";
import { useRecordTableState } from "../state/recordTableStore";
import { RecordTableFloatingCellEditor } from "./RecordTableCell";

type PanelTab = "home" | "timeline" | "notes";

export function RecordTableSidePanel({
  open,
  record,
  objectMetadata,
  onClose,
  onOpenRecord,
  onUpdate,
}: {
  open: boolean;
  record: any;
  objectMetadata: ObjectMetadata;
  onClose: () => void;
  onOpenRecord: () => void;
  onUpdate?: RecordTableContextValue["onUpdate"];
}) {
  const [activeTab, setActiveTab] = useState<PanelTab>("home");
  const columns = useRecordTableState((state) => state.columns);
  const labelIdentifierFieldName = objectMetadata.labelIdentifierFieldName ?? "name";
  const visibleFields = useMemo(
    () =>
      columns
        .filter((column) => column.isVisible)
        .filter((column) => column.field.name !== labelIdentifierFieldName),
    [columns, labelIdentifierFieldName],
  );
  const title = String(
    record?.[labelIdentifierFieldName] ??
      record?.name ??
      record?.title ??
      objectMetadata.labelSingular,
  );
  const initial = title.trim().charAt(0).toUpperCase() || objectMetadata.labelSingular.charAt(0);
  const recordId = String(record?._id ?? "");

  useEffect(() => {
    if (open) setActiveTab("home");
  }, [open, recordId]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
      const target = event.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
      event.preventDefault();
      onOpenRecord();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenRecord]);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      className="record-side-panel"
      bodyClassName="record-side-panel__body"
      footerClassName="record-side-panel__footer"
      header={
        <div className="record-side-panel__identity">
          <span className="record-side-panel__avatar" aria-hidden="true">{initial}</span>
          <span className="record-side-panel__identity-copy">
            <strong>{title}</strong>
            <small>{recordSubtitle(record, objectMetadata.labelSingular)}</small>
          </span>
        </div>
      }
      footer={
        <>
          <Menu
            align="left"
            minWidth={190}
            sections={[
              {
                id: "record",
                items: [
                  {
                    id: "copy-id",
                    label: "Copy record ID",
                    icon: <Clipboard size={14} />,
                    onSelect: () => void navigator.clipboard?.writeText(recordId),
                  },
                  {
                    id: "close",
                    label: "Close sidebar",
                    icon: <X size={14} />,
                    onSelect: onClose,
                  },
                ],
              },
            ]}
            trigger={
              <button type="button" className="btn record-side-panel__options">
                <MoreHorizontal size={14} /> Options
              </button>
            }
          />
          <button
            type="button"
            className="btn btn--accent record-side-panel__open"
            onClick={onOpenRecord}
          >
            <ExternalLink size={14} />
            <span>Open</span>
            <kbd>⌘↵</kbd>
          </button>
        </>
      }
    >
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
    </Drawer>
  );
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
  const canEdit = isFieldEditable(field) && !!onUpdate;
  const value = record?.[field.name];

  useEffect(() => setIsEditing(false), [recordId, field.name]);

  const startEdit = () => {
    if (canEdit) setIsEditing(true);
  };

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
        tabIndex={canEdit ? 0 : undefined}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || !canEdit) return;
          event.preventDefault();
          startEdit();
        }}
      >
        <FieldDisplay value={value} record={record} field={field} />
      </span>
      {canEdit ? (
        <button
          type="button"
          className="record-side-panel__field-edit"
          aria-label={`Edit ${field.label}`}
          title={`Edit ${field.label}`}
          onClick={startEdit}
        >
          <Pencil size={12} />
        </button>
      ) : (
        <span aria-hidden="true" />
      )}
      {isEditing ? (
        <RecordTableFloatingCellEditor
          anchorRef={valueAnchorRef}
          value={value}
          field={field}
          onCommit={async (nextValue) => {
            setIsEditing(false);
            if (Object.is(nextValue, value)) return;
            await onUpdate?.({ recordId, fieldName: field.name, value: nextValue });
          }}
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
