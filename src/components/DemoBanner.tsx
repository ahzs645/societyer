import { isDemoMode } from "../lib/demoMode";
import { Sparkles, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useConfirm } from "./Modal";
import { useToast } from "./Toast";
import { setStoredSocietyId, useSociety } from "../hooks/useSociety";
import { maintenanceErrorMessage, resetDemoData, seedDemoSociety } from "../lib/maintenanceApi";

export function DemoBanner() {
  const demo = isDemoMode();
  const society = useSociety();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState<"seed" | "reset" | null>(null);

  if (!demo || society === undefined || (society && !society.demoMode)) return null;

  return (
    <div className="demo-banner">
      <Sparkles size={14} />
      <span className="demo-banner__copy">
        <strong>Demo mode.</strong>{" "}
        <span className="demo-banner__detail">
          {society
            ? `Viewing ${society.name} — a demo society used to showcase the app.`
            : "No demo society yet. Click Seed to load Riverside Community Society."}
        </span>
      </span>
      <div className="demo-banner__spacer" />
      <div className="demo-banner__actions">
        <button
          className="btn btn--sm btn--ghost"
          disabled={busy !== null}
          onClick={async () => {
            setBusy("seed");
            try {
              const result = await seedDemoSociety();
              setStoredSocietyId(result.societyId);
              toast.success("Demo society seeded");
            } catch (error) {
              toast.error(maintenanceErrorMessage(error));
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
                await resetDemoData();
                setStoredSocietyId(null);
                toast.success("Demo data wiped");
              } catch (error) {
                toast.error(maintenanceErrorMessage(error));
              } finally {
                setBusy(null);
              }
            }}
          >
            Wipe
          </button>
        )}
      </div>
    </div>
  );
}
