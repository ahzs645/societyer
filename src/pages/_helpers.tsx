import { Sparkles } from "lucide-react";
import { ReactNode } from "react";
import { EmptyState, TintedIconTile } from "../components/ui";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

export function SeedPrompt() {
  const seed = useMutation(api.seed.run);
  return (
    <div className="page">
      <EmptyState
        icon={<Sparkles size={20} />}
        title="No society yet"
        action={
          <button className="btn btn--accent" onClick={() => seed({})}>
            <Sparkles size={14} /> Seed demo society
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
        {icon && (
          <TintedIconTile tone={iconColor} size="md" className="page__icon">
            {icon}
          </TintedIconTile>
        )}
        <div className="page__intro">
          <div className="page__eyebrow">Workspace view</div>
          <h1 className="page__title">{title}</h1>
          {subtitle && <p className="page__subtitle">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="page__actions">{actions}</div>}
    </div>
  );
}
