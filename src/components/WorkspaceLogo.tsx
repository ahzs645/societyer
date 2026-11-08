import { useMemo, useState } from "react";
import { workspaceInitial, workspaceLogoSvg, type WorkspaceBrandSource } from "../../shared/workspaceBranding";

function LogoImage({ sources, initial, className }: { sources: string[]; initial: string; className: string }) {
  const [failed, setFailed] = useState<string[]>([]);
  const source = sources.find(value => !failed.includes(value));
  return <span className={className}>
    {source ? <img src={source} alt="" draggable={false} onError={() => setFailed(values => [...values, source])} />
      : <span className="workspace-logo__initial">{initial}</span>}
  </span>;
}

/** Inert image rendering, shared by the shell, switcher, settings and portfolio.
 * Full wordmarks are contained in their viewport, never cropped into a symbol. */
export function WorkspaceLogo({ organization, presentation = "compact", theme = "auto", className = "", label }: {
  organization?: WorkspaceBrandSource | null;
  presentation?: "compact" | "full";
  theme?: "auto" | "light" | "dark";
  className?: string;
  label?: string;
}) {
  const brand = organization?.workspaceBrand;
  const sources = useMemo(() => {
    const dataUrl = (variant: "primary" | "reverse") => brand?.logoSvg
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(workspaceLogoSvg(brand, variant))}` : "";
    return {
      light: [dataUrl("primary"), organization?.logoUrl].filter((value): value is string => Boolean(value)),
      dark: [dataUrl("reverse"), organization?.logoDarkUrl || organization?.logoUrl].filter((value): value is string => Boolean(value)),
    };
  }, [brand, organization?.logoUrl, organization?.logoDarkUrl]);
  const invert = !brand && !organization?.logoDarkUrl && organization?.logoInvertInDarkMode;
  return <span className={`workspace-logo workspace-logo--${presentation} workspace-logo--${theme} ${className}`.trim()}
    data-brand-id={brand?.id} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    <LogoImage sources={sources.light} initial={workspaceInitial(organization?.name)} className="workspace-logo__light" />
    <LogoImage sources={sources.dark} initial={workspaceInitial(organization?.name)} className={`workspace-logo__dark${invert ? " workspace-logo__dark--invert" : ""}`} />
  </span>;
}
