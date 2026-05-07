/**
 * Static, app-wide palette commands. Both the command palette (search) and the
 * sidebar's Favorites section consume this list — the palette renders them as
 * search rows, and the sidebar renders pinned ones as quick-launch buttons.
 *
 * Each command has a stable `id` so it can be persisted in localStorage as a
 * pin reference. The closure-bound `run` is rebuilt every render with whatever
 * navigate/society/toast/etc. happens to be in context — but the id stays
 * constant, so a pin saved last week still works today.
 */
import { useMemo } from "react";
import { useMutation } from "convex/react";
import { useNavigate } from "react-router-dom";
import { Calendar, Download, Eye, FileCheck2, FileCog, PenLine, Settings, ShieldCheck, Sparkles } from "lucide-react";
import type { ComponentType } from "react";
import { api } from "./convexApi";
import { setStoredSocietyId, useSociety } from "../hooks/useSociety";
import { useToast } from "../components/Toast";
import { maintenanceErrorMessage, seedDemoSociety } from "./maintenanceApi";
import type { ModuleKey } from "./modules";

export type StaticCommand = {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number | string }>;
  /** Module gate — command is hidden when the module is disabled. */
  module?: ModuleKey;
  run: () => void | Promise<void>;
};

export function useStaticCommands(): StaticCommand[] {
  const navigate = useNavigate();
  const society = useSociety();
  const toast = useToast();
  const seedSharedViews = useMutation(api.views.seedGovernanceDataTableViews);

  return useMemo<StaticCommand[]>(
    () => [
      {
        id: "action-create-meeting",
        label: "Create meeting",
        icon: Calendar,
        run: () => navigate("/app/meetings?intent=create&type=Board"),
      },
      {
        id: "action-mark-filing-filed",
        label: "Mark filing filed",
        icon: FileCheck2,
        run: () => navigate("/app/filings?intent=mark-filed"),
      },
      {
        id: "action-generate-agm-package",
        label: "Generate AGM package",
        icon: FileCog,
        run: () => navigate("/app/meetings?intent=generate-agm-package&type=AGM"),
      },
      {
        id: "action-draft-minutes",
        label: "Draft minutes",
        icon: PenLine,
        run: () => navigate("/app/minutes?intent=draft"),
      },
      {
        id: "action-request-director-attestation",
        label: "Request director attestation",
        icon: ShieldCheck,
        module: "attestations",
        run: () => navigate("/app/attestations?intent=request"),
      },
      {
        id: "action-export-minute-book",
        label: "Export minute book",
        icon: Download,
        run: () => navigate("/app/minute-book?intent=export"),
      },
      {
        id: "action-start-inspection-response",
        label: "Start inspection response",
        icon: Eye,
        module: "recordsInspection",
        run: () => navigate("/app/inspections?intent=start-response"),
      },
      {
        id: "action-seed-demo",
        label: "Seed demo society",
        icon: Sparkles,
        run: async () => {
          try {
            const result = await seedDemoSociety();
            setStoredSocietyId(result.societyId);
            toast.success("Demo society seeded");
          } catch (error) {
            toast.error(maintenanceErrorMessage(error));
          }
        },
      },
      ...(society
        ? [
            {
              id: "action-seed-shared-views",
              label: "Seed governance shared views",
              icon: Settings,
              run: async () => {
                const result = await seedSharedViews({ societyId: society._id });
                toast.success(
                  "Shared views seeded",
                  `${result.created.length} created, ${result.skipped.length} skipped`,
                );
              },
            } as StaticCommand,
          ]
        : []),
    ],
    [navigate, seedSharedViews, society, toast],
  );
}
