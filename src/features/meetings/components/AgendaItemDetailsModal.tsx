/**
 * Agenda item details (A9): item number as printed, requested action,
 * scheduled time text, consent-agenda flag and presenter.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/convexApi";
import { Modal } from "@/components/Modal";
import { Field } from "@/components/ui";
import { Select } from "@/components/Select";
import { Toggle } from "@/components/Controls";
import { NameAutocomplete } from "@/components/NameAutocomplete";
import { useToast } from "@/components/Toast";
import { usePermissions } from "@/hooks/usePermissions";
import { usePermissionedMutation } from "@/hooks/usePermissionedMutation";
import { useDirtyCloseGuard } from "../lib/useDirtyCloseGuard";

export const REQUESTED_ACTION_OPTIONS = [
  { value: "", label: "Not stated" },
  { value: "approve", label: "For approval" },
  { value: "decide", label: "For decision" },
  { value: "receive", label: "To receive" },
  { value: "discuss", label: "For discussion" },
  { value: "information", label: "For information" },
  { value: "none", label: "No action" },
];

export function requestedActionLabel(value: unknown) {
  return REQUESTED_ACTION_OPTIONS.find((option) => option.value === value)?.label;
}

type Draft = { itemNumber: string; requestedAction: string; scheduledTimeText: string; consent: boolean; presenter: string };

export function AgendaItemDetailsModal({ item, peopleNames = [], onClose }: { item: any | null; peopleNames?: string[]; onClose: () => void }) {
  const { can } = usePermissions();
  const canWrite = can("agendas:write");
  const updateItem = usePermissionedMutation(api.agendas.updateItem, canWrite);
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [initial, setInitial] = useState("");
  useEffect(() => {
    if (!item) { setDraft(null); return; }
    const next = {
      itemNumber: item.itemNumber ?? "",
      requestedAction: item.requestedAction ?? "",
      scheduledTimeText: item.scheduledTimeText ?? "",
      consent: !!item.consent,
      presenter: item.presenter ?? "",
    };
    setDraft(next);
    setInitial(JSON.stringify(next));
  }, [item?._id]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = useDirtyCloseGuard(!!draft && JSON.stringify(draft) !== initial, onClose, "agenda item details");
  if (!item || !draft) return null;
  const save = async () => {
    try {
      await updateItem({
        itemId: item._id,
        itemNumber: draft.itemNumber.trim(),
        requestedAction: draft.requestedAction || undefined,
        scheduledTimeText: draft.scheduledTimeText.trim(),
        consent: draft.consent,
        presenter: draft.presenter.trim(),
      });
      toast.success("Agenda item updated", item.title);
      onClose();
    } catch (error: any) {
      toast.error("Could not update the agenda item", error?.message ?? String(error));
    }
  };
  return (
    <Modal
      open
      onClose={() => { void close(); }}
      title="Agenda item details"
      size="md"
      footer={
        <>
          <button className="btn" type="button" onClick={() => { void close(); }}>Cancel</button>
          <button className="btn btn--accent" type="button" disabled={!canWrite} onClick={() => { void save(); }} data-testid="agenda-item-details-save">Save</button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>{item.title}</p>
      <div className="agenda-item-details">
        <Field label="Item number" hint="As printed, e.g. 4.2 or B">
          <input className="input" value={draft.itemNumber} onChange={(event) => setDraft({ ...draft, itemNumber: event.target.value })} aria-label="Item number" />
        </Field>
        <Field label="Requested action">
          <Select value={draft.requestedAction} onChange={(requestedAction) => setDraft({ ...draft, requestedAction })} options={REQUESTED_ACTION_OPTIONS} aria-label="Requested action" />
        </Field>
        <Field label="Scheduled time" hint="As written, e.g. 6:15 PM">
          <input className="input" value={draft.scheduledTimeText} onChange={(event) => setDraft({ ...draft, scheduledTimeText: event.target.value })} aria-label="Scheduled time" />
        </Field>
        <Field label="Presenter">
          <NameAutocomplete value={draft.presenter} onChange={(presenter) => setDraft({ ...draft, presenter })} options={peopleNames} ariaLabel="Presenter" />
        </Field>
      </div>
      <Toggle checked={draft.consent} onChange={(consent) => setDraft({ ...draft, consent })} label="Consent agenda item (received or adopted without debate)" />
    </Modal>
  );
}
