import { Link } from "react-router-dom";
import { useSociety } from "../hooks/useSociety";
import { isModuleEnabled, MODULES_BY_KEY, type ModuleKey } from "../lib/modules";

export function ModuleGate({
  moduleKey,
  children,
}: {
  moduleKey: ModuleKey;
  children: React.ReactNode;
}) {
  const society = useSociety();

  if (society === undefined || society === null) return <>{children}</>;
  if (isModuleEnabled(society, moduleKey)) return <>{children}</>;

  const module = MODULES_BY_KEY[moduleKey];

  return (
    <div className="page">
      <div className="card" style={{ maxWidth: 720 }}>
        <div className="card__head">
          <h2 className="card__title">{module.label} is disabled</h2>
          <span className="card__subtitle">This workspace turned this module off.</span>
        </div>
        <div className="card__body col">
          <div className="muted">{module.description}</div>
          <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
            Existing records are preserved. Re-enable the module in Settings to access them again.
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Link to="/app/settings" className="btn btn--accent">
              Open settings
            </Link>
            <Link to="/app" className="btn">
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
