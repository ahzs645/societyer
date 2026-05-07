import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { useToast } from "./Toast";
import type { Id } from "../../convex/_generated/dataModel";

/**
 * Shared empty state shown when a record table's object metadata hasn't been
 * seeded yet. Renders a one-click "Seed metadata" button that calls the
 * idempotent `seedRecordTableMetadata.ensureForSociety` mutation, so users
 * never have to drop to the CLI. Newly created societies are auto-seeded at
 * insert time, but this covers older societies that pre-date a given object.
 */
export function RecordTableMetadataEmpty({
  societyId,
  objectLabel,
}: {
  societyId: Id<"societies"> | undefined;
  objectLabel: string;
}) {
  const ensure = useMutation(api.seedRecordTableMetadata.ensureForSociety);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <div className="record-table__empty">
      <div className="record-table__empty-title">Metadata not seeded</div>
      <div className="record-table__empty-desc">
        The {objectLabel} object metadata + default view aren't set up for this society yet.
      </div>
      <button
        className="btn btn--accent btn--sm"
        style={{ marginTop: 8 }}
        disabled={!societyId || busy}
        onClick={async () => {
          if (!societyId) return;
          setBusy(true);
          try {
            await ensure({ societyId });
            toast.success("Metadata seeded.");
          } catch (err: any) {
            toast.error(err?.message ?? "Seeding failed.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Seeding…" : "Seed metadata"}
      </button>
    </div>
  );
}
