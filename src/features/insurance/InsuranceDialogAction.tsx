import { useState, type ReactNode } from "react";
import { Modal } from "../../components/Modal";

export function InsuranceDialogAction({
  label,
  title = label,
  children,
}: {
  label: string;
  title?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn--sm insurance-dialog-action"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      <Modal open={open} title={title} size="md" onClose={() => setOpen(false)}>
        {children}
      </Modal>
    </>
  );
}
