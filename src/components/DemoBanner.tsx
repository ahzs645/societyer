import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { isDemoMode } from "../lib/demoMode";
import { Sparkles, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useConfirm } from "./Modal";
import { useToast } from "./Toast";

export function DemoBanner() {
  const demo = isDemoMode();
  const society = useQuery(api.society.get, {});
  const seed = useMutation(api.seed.run);
  const reset = useMutation(api.seed.reset);
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState<"seed" | "reset" | null>(null);

  if (!demo) return null;

  return (
    <div className="demo-banner">
      <Sparkles size={14} />
      <span>
        <strong>Demo mode.</strong>{" "}
        {society
          ? `Viewing ${society.name} — a fictional BC society used to showcase the app.`
          : "No demo society yet. Click Seed to load Riverside Community Society."}
      </span>
      <div className="demo-banner__spacer" />
      <button
        className="btn btn--sm btn--ghost"
        disabled={busy !== null}
        onClick={async () => {
          setBusy("seed");
          try {
            await seed({});
          } finally {
            setBusy(null);
          }
        }}
      >
        <RefreshCw size={12} />
        {society ? "Reseed" : "Seed demo society"}
      </button>
      {society && (
        <button
          className="btn btn--sm btn--ghost"
          disabled={busy !== null}
          onClick={async () => {
            const ok = await confirm({
              title: "Wipe all demo data?",
              message: "Every table will be dropped. You can reseed immediately after.",
              confirmLabel: "Wipe",
              tone: "danger",
            });
            if (!ok) return;
            setBusy("reset");
            try {
              await reset({});
              toast.success("Demo data wiped");
            } finally {
              setBusy(null);
            }
          }}
        >
          Wipe
        </button>
      )}
    </div>
  );
}
