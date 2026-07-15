import { Plus } from "lucide-react";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";

export function RecordTableActionRow({ colSpan }: { colSpan: number }) {
  return (
    <tr className="record-table__action-row">
      <RecordTableActionRowCells colSpan={colSpan} />
    </tr>
  );
}

export function RecordTableActionRowCells({ colSpan }: { colSpan: number }) {
  const { objectMetadata, onCreate } = useRecordTableContextOrThrow();

  if (!onCreate) return null;

  return (
    <td colSpan={colSpan}>
      <button type="button" onClick={() => void onCreate()}>
        <Plus size={14} />
        <span>Add {objectMetadata.labelSingular.toLowerCase()}</span>
      </button>
    </td>
  );
}
