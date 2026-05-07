import { Sparkles } from "lucide-react";
import { ReactNode, useState } from "react";
import { EmptyState, TintedIconTile } from "../components/ui";
import { useToast } from "../components/Toast";
import { setStoredSocietyId } from "../hooks/useSociety";
import { maintenanceErrorMessage, seedDemoSociety } from "../lib/maintenanceApi";

export function SeedPrompt() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <div className="page">
      <EmptyState
        icon={<Sparkles size={20} />}
        title="No society yet"
        action={
          <button
            className="btn btn--accent"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await seedDemoSociety();
                setStoredSocietyId(result.societyId);
                toast.success("Demo society seeded");
              } catch (error) {
                toast.error(maintenanceErrorMessage(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Sparkles size={14} /> {busy ? "Seeding..." : "Seed demo society"}
          </button>
        }
      >
        Click below to load <strong>Riverside Community Society</strong>, a fictional BC
        non-profit used to showcase the app. You can wipe it any time.
      </EmptyState>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  icon,
  iconColor = "blue",
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  iconColor?: "blue" | "red" | "turquoise" | "gray" | "orange" | "purple" | "green" | "pink" | "yellow";
  actions?: ReactNode;
}) {
  return (
    <div className="page__header">
      <div className="page__header-main">
        <div className="page__intro">
          <h1 className="page__title">
            {icon && (
              <TintedIconTile tone={iconColor} size="md" className="page__icon">
                {icon}
              </TintedIconTile>
            )}
            <span className="page__title-text">{title}</span>
          </h1>
          {subtitle && <p className="page__subtitle">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="page__actions">{actions}</div>}
    </div>
  );
}
