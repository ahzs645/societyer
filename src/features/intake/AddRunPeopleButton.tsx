/** Adds the people named in an intake run to the workspace's people directory, one
 * directory person per distinct full name as written, so promotion can link attendees,
 * chairs, movers and seconders to people. Spelling variants are never folded here: the
 * directory's duplicate suggestions propose merges for a person to decide. Names already
 * in the directory (full name or alias) are skipped; role words and organizations are
 * never added. */
import { useMemo, useState } from "react";
import { UserPlus, Loader2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { usePermissionedMutation } from "../../hooks/usePermissionedMutation";
import { useDirectoryPeople } from "../../components/PersonPicker";
import { useToast } from "../../components/Toast";
import { useConfirm } from "../../components/Modal";
import { pluralize } from "../../lib/format";
import { personNameKey as key, runPeopleNames } from "./runPeople";

export function AddRunPeopleButton({ societyId, people, canWrite }: { societyId: string; people: Array<{ fullName: string; aliases?: string[] }> | undefined; canWrite: boolean }) {
  const directory = useDirectoryPeople(societyId);
  const upsert = usePermissionedMutation(api.peopleDirectory.upsert, canWrite);
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const missing = useMemo(() => {
    if (!directory) return [];
    const known = new Set<string>();
    for (const row of directory as any[]) for (const name of [row.fullName, ...(row.aliases ?? [])]) if (name) known.add(key(String(name)));
    return runPeopleNames(people).filter((name) => !known.has(key(name)));
  }, [directory, people]);
  if (!canWrite || !missing.length) return null;
  const run = async () => {
    const ok = await confirm({
      title: `Add ${pluralize(missing.length, "person", "people")} to the people directory?`,
      message: `One directory person is created for each distinct full name this run found in attendance lists and motions (for example ${missing.slice(0, 3).join(", ")}). Spelling variants stay separate; review the directory's possible duplicates to merge them. Promotion then links attendees, chairs, movers and seconders to these people by exact name.`,
      confirmLabel: `Add ${missing.length}`,
    });
    if (!ok) return;
    setBusy({ done: 0, total: missing.length });
    let added = 0;
    for (const [index, fullName] of missing.entries()) {
      const parts = fullName.split(" ");
      try {
        await upsert({ societyId, fullName, firstName: parts[0], lastName: parts.slice(1).join(" "), isIndividual: true, nowISO: new Date().toISOString() });
        added++;
      } catch {
        // A name the directory refuses stays out; the run keeps it as written.
      }
      if (index % 10 === 0) setBusy({ done: index + 1, total: missing.length });
    }
    setBusy(null);
    toast.success(`Added ${pluralize(added, "person", "people")} to the directory`, "Review possible duplicates in the people directory before merging anyone.");
  };
  return (
    <button type="button" className="btn btn--sm" onClick={() => void run()} disabled={Boolean(busy)} data-testid="intake-add-people">
      {busy ? <><Loader2 size={12} className="spin" /> Adding {busy.done}/{busy.total}…</> : <><UserPlus size={12} /> Add run people to directory ({missing.length})</>}
    </button>
  );
}
