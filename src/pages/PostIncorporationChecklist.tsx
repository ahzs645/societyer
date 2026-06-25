import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { ListChecks, ExternalLink } from "lucide-react";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge } from "../components/ui";
import { useToast } from "../components/Toast";

const CATEGORY_LABEL: Record<string, string> = {
  organize: "Organize the corporation",
  registration: "Register with governments",
  good_standing: "Stay in good standing",
};

const CADENCE_LABEL: Record<string, string> = {
  one_time: "One-time",
  recurring: "Recurring",
  event_driven: "When it changes",
};

/**
 * Post-incorporation checklist — the ordered "what do I do now?" steps after
 * incorporating, from shared/postIncorporationSteps.ts. Each step links to the
 * document packet that produces its paperwork (one-click generate) and to the
 * authoritative government page.
 */
export function PostIncorporationChecklistPage() {
  const society = useSociety();
  const data = useQuery(
    api.postIncorporation.checklist,
    society ? { societyId: society._id } : "skip",
  ) as { steps: any[]; generatedPacketKeys: string[] } | undefined;
  const generate = useMutation(api.legalOperations.generateDocumentFromCatalog);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const steps = data?.steps ?? [];
  const generated = new Set(data?.generatedPacketKeys ?? []);
  const categories = ["organize", "registration", "good_standing"] as const;

  const onGenerate = async (packetKey: string) => {
    setBusy(packetKey);
    try {
      await generate({ societyId: society._id, packetKey, effectiveDate: new Date().toISOString().slice(0, 10) });
      toast.success("Packet staged", "The editable draft is ready in the Template Engine.");
    } catch (err: any) {
      toast.error("Could not generate", err?.message ?? String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Post-incorporation checklist"
        icon={<ListChecks size={16} />}
        iconColor="green"
        subtitle="The ordered next steps after incorporating, each linked to the paperwork it needs and the official source."
      />
      {steps.length === 0 ? (
        <div className="card" style={{ padding: 16 }}>
          <p className="muted" style={{ margin: 0 }}>
            No post-incorporation flow is defined for this entity's jurisdiction/type yet.
            Flows are added per jurisdiction (currently federal CBCA business corporations).
          </p>
        </div>
      ) : (
        categories.map((cat) => {
          const catSteps = steps.filter((s) => s.category === cat);
          if (catSteps.length === 0) return null;
          return (
            <section key={cat} style={{ marginBottom: 20 }}>
              <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>{CATEGORY_LABEL[cat]}</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {catSteps.map((step) => {
                  const done = step.packetKey && generated.has(step.packetKey);
                  return (
                    <div key={step.key} className="card" style={{ padding: 14 }}>
                      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                        <div>
                          <strong>{step.order}. {step.title}</strong>
                          <div className="row" style={{ gap: 6, marginTop: 4 }}>
                            <Badge tone="neutral">{CADENCE_LABEL[step.cadence] ?? step.cadence}</Badge>
                            {done && <Badge tone="success">packet generated</Badge>}
                          </div>
                        </div>
                        {step.packetKey && (
                          <button className="btn btn--sm" disabled={busy === step.packetKey} onClick={() => onGenerate(step.packetKey)}>
                            {busy === step.packetKey ? "Generating…" : done ? "Regenerate" : "Generate packet"}
                          </button>
                        )}
                      </div>
                      <p style={{ margin: "8px 0 6px" }}>{step.summary}</p>
                      <div className="muted" style={{ fontSize: 13 }}>
                        <div><strong>Timing:</strong> {step.timing}</div>
                        <div>
                          <strong>Authority:</strong> {step.authority.body} — {step.authority.citation}{" "}
                          <a href={step.authority.officialUrl} target="_blank" rel="noreferrer" style={{ whiteSpace: "nowrap" }}>
                            official page <ExternalLink size={11} style={{ verticalAlign: "middle" }} />
                          </a>
                        </div>
                        {step.obligation?.filingKind && <div><strong>Recurring filing:</strong> {step.obligation.filingKind}</div>}
                        {step.caveat && <div style={{ marginTop: 4, fontStyle: "italic" }}>{step.caveat}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

export default PostIncorporationChecklistPage;
