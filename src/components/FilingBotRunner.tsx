import { useAction, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { Drawer, Badge } from "./ui";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { useToast } from "./Toast";
import { useState } from "react";
import { Bot, CheckCircle2, Circle, XCircle, Loader2, ExternalLink, FileText } from "lucide-react";
import { formatDateTime } from "../lib/format";

export function FilingBotRunner({
  open,
  onClose,
  filingId,
  societyId,
  filingLabel,
}: {
  open: boolean;
  onClose: () => void;
  filingId: Id<"filings"> | null;
  societyId: Id<"societies">;
  filingLabel: string;
}) {
  const runs = useQuery(
    api.filingBot.runsForFiling,
    filingId ? { filingId } : "skip",
  );
  const packet = useQuery(
    api.filingBot.buildFilingPacket,
    filingId && open
      ? { societyId, kind: (filingLabel.split(":")[0] || "AnnualReport").trim() }
      : "skip",
  );
  const runBot = useAction(api.filingBot.run);
  const actingUserId = useCurrentUserId() ?? undefined;
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const active = (runs ?? []).find((r) => r.status === "queued" || r.status === "running");
  const last = (runs ?? [])[0];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Societies Online bot · ${filingLabel}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>Close</button>
          <button
            className="btn btn--accent"
            disabled={busy || !!active}
            onClick={async () => {
              if (!filingId) return;
              setBusy(true);
              try {
                await runBot({ societyId, filingId, actingUserId });
                toast.success("Filing bot finished — see Filings for confirmation #");
              } catch (err: any) {
                toast.error(err?.message ?? "Bot failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Bot size={14} /> {busy || active ? "Bot running…" : "Run filing bot"}
          </button>
        </>
      }
    >
      <div className="muted" style={{ marginBottom: 12, fontSize: "var(--fs-md)" }}>
        The Societies Online portal has no public API — auto-submission isn't
        permitted. The bot gathers and validates everything, pre-fills Form 11,
        stages signatures, then deep-links you to <a href="https://www.bcregistry.ca/societies/" target="_blank" rel="noreferrer">bcregistry.ca/societies <ExternalLink size={11} /></a>{" "}
        for final submission. Demo mode simulates submission and a confirmation number.
      </div>

      {packet && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card__head">
            <h3 className="card__title" style={{ fontSize: "var(--fs-md)" }}>
              <FileText size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
              Filing packet preview
            </h3>
          </div>
          <div className="card__body">
            <pre
              style={{
                margin: 0,
                fontSize: "var(--fs-sm)",
                lineHeight: 1.4,
                whiteSpace: "pre-wrap",
                fontFamily: "var(--font-mono)",
                color: "var(--text-secondary)",
                maxHeight: 220,
                overflow: "auto",
              }}
            >
              {JSON.stringify(packet, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {(active || last) && (
        <div>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
            <strong style={{ fontSize: "var(--fs-md)" }}>
              Last run
            </strong>
            {(active ?? last) && (
              <Badge
                tone={
                  (active ?? last).status === "success"
                    ? "success"
                    : (active ?? last).status === "failed"
                    ? "danger"
                    : "warn"
                }
              >
                {(active ?? last).status}
              </Badge>
            )}
            <div style={{ flex: 1 }} />
            <span className="muted mono" style={{ fontSize: "var(--fs-sm)" }}>
              {(active ?? last).demo ? "demo" : "live"} · {formatDateTime((active ?? last).startedAtISO)}
            </span>
          </div>

          <div className="bot-steps">
            {(active ?? last).steps.map((s, i) => {
              const Icon =
                s.status === "ok"
                  ? CheckCircle2
                  : s.status === "fail"
                  ? XCircle
                  : s.status === "running"
                  ? Loader2
                  : Circle;
              const color =
                s.status === "ok"
                  ? "var(--success)"
                  : s.status === "fail"
                  ? "var(--danger)"
                  : s.status === "running"
                  ? "var(--accent)"
                  : "var(--text-tertiary)";
              return (
                <div key={i} className={`bot-step bot-step--${s.status}`}>
                  <Icon
                    size={14}
                    style={{
                      color,
                      animation: s.status === "running" ? "spin 1.2s linear infinite" : undefined,
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div>{s.label}</div>
                    {s.note && (
                      <div className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 2 }}>
                        {s.note}
                      </div>
                    )}
                  </div>
                  {s.atISO && (
                    <span className="muted mono" style={{ fontSize: "var(--fs-xs)" }}>
                      {new Date(s.atISO).toLocaleTimeString()}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {(active ?? last).confirmationNumber && (
            <div
              style={{
                marginTop: 12,
                padding: 10,
                background: "var(--accent-soft)",
                borderRadius: "var(--r-sm)",
              }}
            >
              <strong>Confirmation #</strong>{" "}
              <span className="mono">{(active ?? last).confirmationNumber}</span>
              <a
                className="btn btn--ghost btn--sm"
                href="https://www.bcregistry.ca/societies/"
                target="_blank"
                rel="noreferrer"
                style={{ marginLeft: 8 }}
              >
                Open Societies Online <ExternalLink size={11} />
              </a>
            </div>
          )}
        </div>
      )}

      {!active && !last && (
        <div className="muted" style={{ padding: 16, textAlign: "center" }}>
          No runs yet. Click "Run filing bot" to stage this filing.
        </div>
      )}
    </Drawer>
  );
}
