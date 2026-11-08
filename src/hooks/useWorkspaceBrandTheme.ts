import { useLayoutEffect } from "react";
import { workspaceAccentPalette, type WorkspaceBrandSource } from "../../shared/workspaceBranding";

/** Own only accent tokens while the authenticated workspace shell is mounted.
 * Putting tokens on the root also covers menus/dialogs rendered in portals.
 * Cleanup restores the application theme on workspace switch and sign-out. */
export function useWorkspaceBrandTheme(organization?: WorkspaceBrandSource | null) {
  const primary = organization?.workspaceBrand?.primary;
  const enabled = Boolean(primary && organization?.workspaceBrandUseAccent);
  useLayoutEffect(() => {
    if (!enabled || !primary) return;
    const root = document.documentElement;
    const properties = ["--accent-primary", "--accent", "--accent-hover", "--accent-text", "--accent-on-accent", "--accent-on",
      "--accent-tertiary", "--accent-quaternary", "--accent-accent-4", "--accent-soft", "--accent-soft-strong", "--border-focus", "--focus-ring-color"];
    const previous = properties.map(name => [name, root.style.getPropertyValue(name), root.style.getPropertyPriority(name)] as const);
    const apply = () => {
      const style = getComputedStyle(root);
      const palette = workspaceAccentPalette(primary, root.classList.contains("dark"),
        [style.getPropertyValue("--bg-panel").trim(), style.getPropertyValue("--bg-subtle").trim()]);
      const values: Record<string, string> = {
        "--accent-primary": palette.accent, "--accent": palette.accent, "--accent-hover": palette.hover,
        "--accent-text": palette.text, "--accent-on-accent": palette.on, "--accent-on": palette.on,
        "--accent-tertiary": palette.strong, "--accent-quaternary": palette.soft, "--accent-accent-4": palette.strong,
        "--accent-soft": palette.soft, "--accent-soft-strong": palette.strong, "--border-focus": palette.accent,
        "--focus-ring-color": palette.accent,
      };
      for (const [name, value] of Object.entries(values)) root.style.setProperty(name, value);
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => {
      observer.disconnect();
      for (const [name, value, priority] of previous) {
        if (value) root.style.setProperty(name, value, priority);
        else root.style.removeProperty(name);
      }
    };
  }, [organization?._id, enabled, primary]);
}
