import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { FlaskConical, RotateCcw } from "lucide-react";
import { PageHeader } from "./_helpers";
import {
  RecordTable,
  RecordTableScope,
  RecordTableToolbar,
  useRecordTableState,
} from "@/modules/object-record";
import {
  LAB_FIELD_DEFINITIONS,
  LAB_FIELDS,
  LAB_OBJECT,
  LAB_VIEW,
  applyLabEdit,
  initialLabRecord,
  type LabRecord,
} from "@/modules/object-record/record-table/testing/fieldLabFixture";
import { isStaticDemoRuntime } from "@/lib/staticRuntime";

function FieldLabStatus({ editedFields }: { editedFields: string[] }) {
  const editingCell = useRecordTableState((state) => state.editingCell);
  const columns = useRecordTableState((state) => state.columns);
  const editingField = editingCell
    ? columns.filter((column) => column.isVisible)[editingCell.columnIndex]?.field.name
    : undefined;

  return (
    <div
      className="record-table-field-lab__status"
      role="status"
      data-testid="field-lab-status"
      data-editing-field={editingField ?? ""}
    >
      <strong>{editedFields.length} / {LAB_FIELDS.length} field types edited</strong>
      <span>{editedFields.length > 0 ? editedFields.join(", ") : "No edits yet"}</span>
    </div>
  );
}

export function RecordTableFieldLabPage() {
  const [record, setRecord] = useState<LabRecord>(() => initialLabRecord());
  const [editedFields, setEditedFields] = useState<string[]>([]);

  const relationLabels = useMemo(
    () =>
      new Map(
        ((LAB_FIELD_DEFINITIONS.find((field) => field.name === "relation")?.config?.options ?? []) as Array<{
          value: string;
          label: string;
        }>).map((option) => [option.value, option.label]),
      ),
    [],
  );

  if (!isStaticDemoRuntime()) return <Navigate to="/app" replace />;

  return (
    <div className="page record-table-field-lab">
      <PageHeader
        title="Table field lab"
        icon={<FlaskConical size={16} />}
        iconColor="purple"
        subtitle="Demo-only acceptance surface for every RecordTable field type."
        actions={
          <button
            type="button"
            className="btn-action"
            onClick={() => {
              setRecord(initialLabRecord());
              setEditedFields([]);
            }}
          >
            <RotateCcw size={12} /> Reset lab
          </button>
        }
      />

      <RecordTableScope
        tableId="record-table-field-lab"
        objectMetadata={LAB_OBJECT}
        hydratedView={LAB_VIEW}
        records={[record]}
        onUpdate={({ fieldName, value }) => {
          setRecord((current) => applyLabEdit(current, fieldName, value, relationLabels));
          setEditedFields((current) =>
            current.includes(fieldName) ? current : [...current, fieldName],
          );
        }}
      >
        <RecordTableToolbar label="All field types" />
        <RecordTable virtualizeAbove={100} showAggregateFooter={false} />
        <FieldLabStatus editedFields={editedFields} />
      </RecordTableScope>
    </div>
  );
}
