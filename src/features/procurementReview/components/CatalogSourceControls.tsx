import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../../lib/convexApi";
import { useToast } from "../../../components/Toast";

/** Only mounted for settings editors; the server enforces the same permission. */
export function CatalogSourceControls({ societyId, previewReady = false, onClose }: {
  societyId: string;
  previewReady?: boolean;
  onClose?: () => void;
}) {
  const configuration = useQuery(api.procurementCatalog.configuration, { societyId, controls: true }) as {
    source: "convex" | "service"; serviceAvailable?: boolean; qualifiedPublications?: number; convexFallbackAvailable?: boolean;
  } | undefined;
  const changeSource = useMutation(api.procurementCatalog.setSource);
  const [params, setParams] = useSearchParams(), [saving, setSaving] = useState(false);
  const toast = useToast(), preview = params.get("catalogPreview") === "service";
  if (!configuration?.serviceAvailable) return null;
  const verified = configuration.qualifiedPublications ?? 0;
  const showPreview = (enabled: boolean) => setParams(current => {
    const next = new URLSearchParams(current);
    if (enabled) next.set("catalogPreview", "service"); else next.delete("catalogPreview");
    return next;
  });
  const save = async (source: "convex" | "service") => {
    setSaving(true);
    try {
      await changeSource({ societyId, source });
      showPreview(false);
      toast.success("Catalog source updated", source === "service" ? "This workspace now reads the catalog service." : "This workspace now reads its Convex catalog.");
      onClose?.();
    } catch (error) {
      toast.error("Couldn't change the catalog source", error instanceof Error ? error.message : undefined);
    } finally { setSaving(false); }
  };
  return <section className="card procurement-review__state" aria-label="Catalog source">
    <div className="card__head"><h2 className="card__title">Catalog source</h2></div>
    <div className="card__body col">
      <p>{configuration.source === "service" ? "This workspace reads the catalog service." : preview ? "Catalog service preview. Other readers continue using Convex." : "The catalog service is available for this workspace. Preview it before switching."}</p>
      {configuration.source === "convex" && <p className="muted">{verified} of 3 consecutive publications verified. Switching requires all three to match.</p>}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {configuration.source === "convex" && <>
          <button type="button" className="btn" disabled={saving} onClick={() => showPreview(!preview)}>{preview ? "Return to current catalog" : "Preview catalog service"}</button>
          {preview && <button type="button" className="btn btn--accent" disabled={saving || verified < 3 || !previewReady} onClick={() => void save("service")}>{saving ? "Switching…" : "Use catalog service"}</button>}
        </>}
        {configuration.source === "service" && configuration.convexFallbackAvailable !== false && <button type="button" className="btn" disabled={saving} onClick={() => void save("convex")}>{saving ? "Switching…" : "Use Convex fallback"}</button>}
        {onClose && <button type="button" className="btn btn--ghost" disabled={saving} onClick={onClose}>Close</button>}
      </div>
    </div>
  </section>;
}
