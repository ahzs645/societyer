import { isValidElement, useCallback, useMemo, type ReactNode } from "react";
import { useRecordTableState } from "../state/recordTableStore";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { FieldDisplay } from "../../record-field/components/FieldDisplay";
import type { FieldMetadata } from "../../types";
import { useFilteredRecords } from "../hooks/useFilteredRecords";
import {
  autoPhoneCardBadgeVaries,
  autoPhoneCardFactLabel,
  autoPhoneCardMeta,
  autoPhoneCardTitle,
  autoPhoneCardTitlesFit,
  planAutoPhoneCard,
  type AutoPhoneCardPlan,
} from "../utils/autoPhoneCard";
import type { RecordTableCardHelpers, RecordTableCardRecord, RecordTableCardRenderer } from "./RecordTableCardList";
import type { RecordTableCellRenderer } from "./RecordTable";
import { RecordTablePhoneCard } from "./RecordTablePhoneCard";

/**
 * Past this many records the phone keeps the virtualised table: the card
 * list renders every card.
 */
const AUTO_CARD_MAX_RECORDS = 500;

const INTERACTIVE_TAGS = new Set(["a", "button", "input", "select", "textarea", "label", "details", "summary"]);
/** Block content stacks lines, which the card's one meta line cannot hold. */
const BLOCK_TAGS = new Set(["div", "p", "ul", "ol", "li", "table", "br", "img", "svg", "picture", "video"]);
const INTERACTIVE_PROPS = ["onClick", "onChange", "onMouseDown", "onPointerDown", "onKeyDown", "href", "to"];

function isPrimitive(value: unknown): boolean {
  return value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/**
 * Whether a page's custom cell content is a short, display-only run of text
 * that can sit inside the card's open button and on its one meta line: text,
 * inline spans and simple components such as a Badge. A checkbox, link or
 * button (Deadlines' "done" tick) would nest one control in another; stacked
 * blocks (a category over its type) or components fed with data (a receipt
 * list) don't fit one line. The card then uses the field's standard display.
 */
function isInlineDisplay(node: ReactNode, depth = 0): boolean {
  if (node == null || typeof node === "boolean" || typeof node === "string" || typeof node === "number") return true;
  if (Array.isArray(node)) return node.every((child) => isInlineDisplay(child, depth + 1));
  if (!isValidElement(node) || depth > 6) return false;
  const props = node.props as Record<string, unknown>;
  if (INTERACTIVE_PROPS.some((name) => props[name] != null)) return false;
  if (typeof node.type === "string") {
    if (INTERACTIVE_TAGS.has(node.type) || BLOCK_TAGS.has(node.type)) return false;
  } else if (Object.entries(props).some(([name, value]) => name !== "children" && !isPrimitive(value))) {
    return false;
  }
  return isInlineDisplay(props.children as ReactNode, depth + 1);
}

/**
 * RecordTable's default phone card, used when a page passes no
 * `renderPhoneCard`: the record's title, its first status/select field as
 * the cell draws it, and up to two more fields (a short fact and a date) on
 * the meta line, all through the table's own cell renderers. The row's
 * actions open from RecordTablePhoneCard's "…" button.
 *
 * Returns null — keep the column table — off phones, outside the table view,
 * without a way to open records, when the view has no title-like identifier
 * or most records have no title, or for very long tables.
 */
export function useAutoPhoneCard({
  enabled,
  renderCell,
}: {
  enabled: boolean;
  renderCell?: RecordTableCellRenderer;
}): RecordTableCardRenderer | null {
  const { objectMetadata } = useRecordTableContextOrThrow();
  const columns = useRecordTableState((s) => s.columns);
  const records = useRecordTableState((s) => s.records);
  const plan = useMemo(
    () => (enabled ? planAutoPhoneCard(columns, objectMetadata.labelIdentifierFieldName) : null),
    [enabled, columns, objectMetadata.labelIdentifierFieldName],
  );
  const usable = !!plan && records.length <= AUTO_CARD_MAX_RECORDS && autoPhoneCardTitlesFit(records, plan);
  // The badge only when it differs between the cards on screen (after search
  // and filters): "Open" on every card of an open-items view says nothing.
  const visibleRecords = useFilteredRecords();
  const showBadge = useMemo(() => !!plan && autoPhoneCardBadgeVaries(visibleRecords, plan), [plan, visibleRecords]);
  const cardPlan = useMemo(() => (plan && !showBadge ? { ...plan, badge: undefined } : plan), [plan, showBadge]);
  const render = useCallback<RecordTableCardRenderer>(
    (record, helpers) =>
      cardPlan ? (
        <AutoPhoneCard record={record} helpers={helpers} plan={cardPlan} renderCell={renderCell} />
      ) : null,
    [cardPlan, renderCell],
  );
  return usable ? render : null;
}

function AutoPhoneCard({
  record,
  helpers,
  plan,
  renderCell,
}: {
  record: RecordTableCardRecord;
  helpers: RecordTableCardHelpers;
  plan: AutoPhoneCardPlan;
  renderCell?: RecordTableCellRenderer;
}) {
  const { objectMetadata } = useRecordTableContextOrThrow();
  const title = autoPhoneCardTitle(record, plan) ?? `Untitled ${objectMetadata.labelSingular.toLowerCase()}`;

  // The page's own renderer when it is a short display-only run (Documents'
  // category badge, Deadlines' red overdue date), else the field's standard display.
  const display = (field: FieldMetadata): ReactNode => {
    const value = record[field.name];
    if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return null;
    const custom = renderCell?.({ record, field, value });
    if (custom != null && custom !== false && isInlineDisplay(custom)) return custom;
    return <FieldDisplay value={value} record={record} field={field} />;
  };

  const badge = plan.badge ? display(plan.badge) : null;
  const meta = autoPhoneCardMeta(record, plan).map((field) => {
    const content = display(field);
    if (content == null) return null;
    const prefix = autoPhoneCardFactLabel(field);
    return (
      <span key={field.name} className="record-phone-card__auto-fact">
        {prefix && <span className="record-phone-card__fact-label">{prefix} </span>}
        {content}
      </span>
    );
  });

  return (
    <RecordTablePhoneCard
      title={title}
      badge={badge}
      meta={meta}
      onOpen={helpers.open}
      selecting={helpers.selecting}
      variant="auto"
    />
  );
}
