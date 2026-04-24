import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Banner, Field } from "../components/ui";
import { useToast } from "../components/Toast";
import {
  BookOpen,
  FileDown,
  GitCompare,
  ChevronRight,
  ChevronDown,
  ClipboardCheck,
  Flag,
  Undo2,
  PenLine,
  MessageSquare,
  CheckCircle2,
  Bot,
  Database,
  FileSearch,
  ScanText,
} from "lucide-react";
import { formatDateTime, formatDate, relative } from "../lib/format";
import { exportWordDoc, escapeHtml } from "../lib/exportWord";

// Word-level diff reused from BylawDiff (inline so we don't couple the pages)
type Chunk = { kind: "same" | "add" | "del"; text: string };
const MAX_EXACT_DIFF_CELLS = 2_500_000;

function tokenize(s: string): string[] {
  return s.match(/(\s+|[\wÀ-ÿ]+|[^\s\w])/g) ?? [];
}

function diff(oldTokens: string[], newTokens: string[]): Chunk[] {
  const n = oldTokens.length;
  const m = newTokens.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = oldTokens[i] === newTokens[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const chunks: Chunk[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (oldTokens[i] === newTokens[j]) { chunks.push({ kind: "same", text: oldTokens[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { chunks.push({ kind: "del", text: oldTokens[i] }); i++; }
    else { chunks.push({ kind: "add", text: newTokens[j] }); j++; }
  }
  while (i < n) chunks.push({ kind: "del", text: oldTokens[i++] });
  while (j < m) chunks.push({ kind: "add", text: newTokens[j++] });
  return chunks;
}

function wordCount(text: string): number {
  return text.match(/[\wÀ-ÿ]+/g)?.length ?? 0;
}

function textChangeSummary(oldText: string, newText: string): string {
  const oldWords = wordCount(oldText);
  const newWords = wordCount(newText);
  const delta = newWords - oldWords;
  if (delta === 0) return `${newWords.toLocaleString()} words`;
  return `${newWords.toLocaleString()} words (${delta > 0 ? "+" : ""}${delta.toLocaleString()})`;
}

function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const diffState = useMemo(() => {
    const oldTokens = tokenize(oldText);
    const newTokens = tokenize(newText);
    if (oldTokens.length * newTokens.length > MAX_EXACT_DIFF_CELLS) {
      return { tooLarge: true as const, oldWords: wordCount(oldText), newWords: wordCount(newText), chunks: [], adds: 0, dels: 0 };
    }
    const chunks = diff(oldTokens, newTokens);
    let adds = 0, dels = 0;
    for (const c of chunks) {
      if (c.kind === "add") adds += c.text.trim() ? 1 : 0;
      if (c.kind === "del") dels += c.text.trim() ? 1 : 0;
    }
    return { tooLarge: false as const, oldWords: 0, newWords: 0, chunks, adds, dels };
  }, [oldText, newText]);

  if (diffState.tooLarge) {
    return (
      <div className="col" style={{ gap: 12 }}>
        <Banner tone="warn" title="Exact redline skipped">
          This bylaws version is too large for the in-browser word diff. Use the current text export or split the amendment into smaller sections to review the exact redline.
        </Banner>
        <div className="row" style={{ gap: 12, alignItems: "stretch", flexWrap: "wrap" }}>
          <TextSnapshot title={`Before (${diffState.oldWords.toLocaleString()} words)`} text={oldText} />
          <TextSnapshot title={`After (${diffState.newWords.toLocaleString()} words)`} text={newText} />
        </div>
      </div>
    );
  }

  const chunks = diffState.chunks;
  return (
    <>
      <div className="muted" style={{ marginBottom: 8, fontSize: "var(--fs-sm)" }}>
        <span style={{ color: "var(--success)" }}>+{diffState.adds}</span>{" "}
        <span style={{ color: "var(--danger)" }}>−{diffState.dels}</span>{" "}
        words changed
      </div>
      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, fontSize: "var(--fs-md)" }}>
        {chunks.map((c, i) => {
          if (c.kind === "same") return <span key={i}>{c.text}</span>;
          if (c.kind === "add") return <span key={i} style={{ background: "#d4f4dd", color: "#0a5e32" }}>{c.text}</span>;
          return <span key={i} style={{ background: "#fde1e6", color: "#9b1c3a", textDecoration: "line-through" }}>{c.text}</span>;
        })}
      </div>
    </>
  );
}

function TextSnapshot({ title, text }: { title: string; text: string }) {
  return (
    <div style={{ flex: "1 1 320px", minWidth: 0 }}>
      <div className="muted" style={{ marginBottom: 6, fontSize: "var(--fs-sm)" }}>{title}</div>
      <pre
        style={{
          margin: 0,
          maxHeight: 420,
          overflow: "auto",
          whiteSpace: "pre-wrap",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-sm)",
          background: "var(--bg-subtle)",
          padding: 12,
          borderRadius: 6,
          lineHeight: 1.5,
        }}
      >
        {text}
      </pre>
    </div>
  );
}

// ============================================================================

type View = "timeline" | "current";

export function BylawsHistoryPage() {
  const society = useSociety();
  const toast = useToast();
  const amendments = useQuery(
    api.bylawAmendments.list,
    society ? { societyId: society._id } : "skip",
  );
  const scanPaperlessBylaws = useAction(api.paperless.createBylawsHistoryImportSession);

  const [view, setView] = useState<View>("timeline");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [paperlessQuery, setPaperlessQuery] = useState("bylaws by-laws constitution special resolution");
  const [paperlessLimit, setPaperlessLimit] = useState(500);
  const [paperlessBusy, setPaperlessBusy] = useState(false);
  const [registryBusy, setRegistryBusy] = useState(false);
  const [lastBotSessionId, setLastBotSessionId] = useState<string | null>(null);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  // Order: Filed amendments, oldest first. Treat `filedAtISO` as the event date.
  const filed = (amendments ?? [])
    .filter((a: any) => a.status === "Filed" && a.filedAtISO)
    .sort((a: any, b: any) => (a.filedAtISO ?? "").localeCompare(b.filedAtISO ?? ""));

  const inFlight = (amendments ?? [])
    .filter((a: any) => a.status === "Draft" || a.status === "Consultation" || a.status === "ResolutionPassed")
    .sort((a: any, b: any) => b.updatedAtISO.localeCompare(a.updatedAtISO));

  const withdrawn = (amendments ?? []).filter((a: any) => a.status === "Withdrawn" || a.status === "Superseded");

  // Current bylaws = the proposedText of the most recently filed amendment.
  // (If you model per-section amendments, swap this for a "merge all filed" routine.)
  const current = filed[filed.length - 1];
  const firstFiledAt = filed[0]?.filedAtISO;

  const exportCurrent = () => {
    if (!current) return;
    const bodyHtml = `
      <h1>${escapeHtml(society.name)} — Bylaws (current)</h1>
      <p class="meta">Effective ${escapeHtml(formatDate(current.filedAtISO))} · Last amended ${escapeHtml(formatDateTime(current.filedAtISO))}</p>
      <p class="meta">Filed via Societies Online${current.filingId ? "" : ""}.</p>
      <pre style="font-family: inherit; white-space: pre-wrap; font-size: 11pt; line-height: 1.5;">${escapeHtml(current.proposedText)}</pre>
      <h2>Amendment history</h2>
      <ol>
        ${filed.map((a: any) => `<li>${escapeHtml(formatDate(a.filedAtISO))} — ${escapeHtml(a.title)} (For ${a.votesFor ?? "?"} · Against ${a.votesAgainst ?? 0} · Abstain ${a.abstentions ?? 0})</li>`).join("")}
      </ol>
    `;
    exportWordDoc({
      filename: "bylaws-current.doc",
      title: `${society.name} — Bylaws`,
      bodyHtml,
    });
  };

  const runPaperlessBot = async () => {
    if (paperlessBusy) return;
    setPaperlessBusy(true);
    try {
      const result = await scanPaperlessBylaws({
        societyId: society._id,
        query: paperlessQuery.trim() || undefined,
        maxDocuments: paperlessLimit,
      });
      setLastBotSessionId(result.sessionId);
      toast.success(
        "Paperless bylaws review staged",
        `${result.bylawAmendments ?? 0} candidate version(s), ${result.visionQueue ?? 0} needing page review`,
      );
    } catch (error: any) {
      toast.error("Could not scan Paperless bylaws", error?.message ?? "Check the Paperless connection and try again.");
    } finally {
      setPaperlessBusy(false);
    }
  };

  const runRegistryBot = async () => {
    if (registryBusy) return;
    setRegistryBusy(true);
    try {
      const response = await fetch("/api/v1/browser-connectors/bylaws-history/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          societyId: society._id,
          corpNum: society.incorporationNumber,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? payload?.message ?? `Request failed with ${response.status}`);
      }
      const data = payload.data ?? {};
      if (data.sessionId) {
        setLastBotSessionId(data.sessionId);
        toast.success(
          "BC Registry bylaws review staged",
          `${data.bylawAmendments ?? 0} candidate version(s), ${data.visionQueue ?? 0} needing page review`,
        );
      } else {
        toast.warn(
          "No BC Registry bylaws staged",
          data.missing?.map?.((item: any) => item.message ?? item.reason).filter(Boolean).join(" ") ?? "No matching rows were found.",
        );
      }
    } catch (error: any) {
      toast.error("Could not stage BC Registry bylaws", error?.message ?? "Open a BC Registry browser session and try again.");
    } finally {
      setRegistryBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Bylaws history"
        icon={<BookOpen size={16} />}
        iconColor="purple"
        subtitle="Every filed amendment from incorporation to today — with the diff at each step and the assembled current text."
        actions={
          <>
            <div className="segmented">
              <button className={`segmented__btn${view === "timeline" ? " is-active" : ""}`} onClick={() => setView("timeline")}>Timeline</button>
              <button className={`segmented__btn${view === "current" ? " is-active" : ""}`} onClick={() => setView("current")}>Current bylaws</button>
            </div>
            <Link to="/app/bylaw-diff" className="btn-action"><GitCompare size={12} /> New amendment</Link>
            {current && <button className="btn-action" onClick={exportCurrent}><FileDown size={12} /> Export current</button>}
          </>
        }
      />

      <div className="stat-grid">
        <Stat label="Filed amendments" value={String(filed.length)} />
        <Stat label="In flight" value={String(inFlight.length)} sub="Drafts + active consultations" />
        <Stat
          label="First filing"
          value={firstFiledAt ? formatDate(firstFiledAt) : "—"}
          sub={firstFiledAt ? relative(firstFiledAt) : undefined}
        />
        <Stat
          label="Last amended"
          value={current ? formatDate(current.filedAtISO) : "—"}
          sub={current ? relative(current.filedAtISO) : undefined}
        />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <div>
            <h2 className="card__title"><Bot size={14} /> Bylaws history bot</h2>
            <p className="card__subtitle">
              Stage BC Registry and Paperless sources as markdown bylaw versions, then approve them in Import Sessions before they update this timeline.
            </p>
          </div>
          {lastBotSessionId && (
            <Link to="/app/imports" className="btn-action">
              <FileSearch size={12} /> Review staged records
            </Link>
          )}
        </div>
        <div className="card__body col" style={{ gap: 12 }}>
          <Banner tone="warn" icon={<ScanText size={14} />} title="Scans need review">
            Digital OCR is normalized into Markdown automatically. Scan-only PDFs are queued for page-by-page vision transcription and should stay pending until a reviewer confirms the text.
          </Banner>
          <div className="row" style={{ gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <Field label="Paperless search">
              <input
                className="input"
                value={paperlessQuery}
                onChange={(event) => setPaperlessQuery(event.target.value)}
              />
            </Field>
            <Field label="Max documents">
              <input
                className="input"
                type="number"
                min={1}
                max={1179}
                value={paperlessLimit}
                onChange={(event) => setPaperlessLimit(Number(event.target.value) || 1)}
              />
            </Field>
            <button className="btn-action btn-action--primary" disabled={paperlessBusy} onClick={runPaperlessBot}>
              <Database size={12} /> {paperlessBusy ? "Scanning..." : "Scan Paperless"}
            </button>
            <button className="btn-action" disabled={registryBusy} onClick={runRegistryBot}>
              <FileDown size={12} /> {registryBusy ? "Staging..." : "Stage BC Registry"}
            </button>
          </div>
        </div>
      </div>

      {view === "current" && (
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Current bylaws</h2>
            <span className="card__subtitle">
              {current
                ? `Effective ${formatDate(current.filedAtISO)} — last amendment: ${current.title}`
                : "No amendments filed yet."}
            </span>
          </div>
          <div className="card__body">
            {current ? (
              <pre
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-sm)",
                  background: "var(--bg-subtle)",
                  padding: 16,
                  borderRadius: 6,
                  lineHeight: 1.5,
                }}
              >
                {current.proposedText}
              </pre>
            ) : (
              <div className="muted">Upload the original bylaws as a bylaw amendment to start the history.</div>
            )}
          </div>
        </div>
      )}

      {view === "timeline" && (
        <>
          {inFlight.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card__head"><h2 className="card__title">In flight</h2></div>
              <div className="card__body col" style={{ gap: 6 }}>
                {inFlight.map((a: any) => (
                  <Link
                    key={a._id}
                    to={`/app/bylaw-diff`}
                    onClick={() => {
                      // nudge the BylawDiff page to focus this one via query param
                    }}
                    className="row"
                    style={{
                      padding: 10,
                      border: "1px dashed var(--accent)",
                      background: "var(--accent-soft)",
                      borderRadius: 6,
                      gap: 8,
                    }}
                  >
                    <StatusIcon status={a.status} />
                    <strong style={{ flex: 1 }}>{a.title}</strong>
                    <Badge tone={statusTone(a.status)}>{statusLabel(a.status)}</Badge>
                    <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>Updated {relative(a.updatedAtISO)}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <div className="card__head"><h2 className="card__title">Filed history</h2></div>
            <div className="card__body">
              {filed.length === 0 && <div className="muted">No filed amendments yet.</div>}
              <div className="timeline-vertical">
                {filed.map((a: any, i: number) => {
                  const isExpanded = expanded.has(a._id);
                  return (
                    <div className="timeline-vertical__item" key={a._id}>
                      <span className="timeline-vertical__dot" style={{ borderColor: "var(--success)", background: "var(--success)" }} />
                      <div className="row" style={{ gap: 8 }}>
                        <span className="mono muted" style={{ fontSize: "var(--fs-sm)" }}>
                          {formatDate(a.filedAtISO)}
                        </span>
                        <Badge tone="success">v{i + 1} · Filed</Badge>
                        {a.votesFor != null && (
                          <Badge>
                            For {a.votesFor} · Against {a.votesAgainst ?? 0} · Abstain {a.abstentions ?? 0}
                          </Badge>
                        )}
                      </div>
                      <div className="timeline-vertical__title" style={{ marginTop: 4 }}>
                        <strong>{a.title}</strong>
                      </div>
                      <div className="timeline-vertical__desc">
                        {textChangeSummary(a.baseText, a.proposedText)} · consultation {a.consultationStartedAtISO ? formatDate(a.consultationStartedAtISO) : "—"} → resolution {a.resolutionPassedAtISO ? formatDate(a.resolutionPassedAtISO) : "—"}
                      </div>
                      <div className="row" style={{ marginTop: 8, gap: 4 }}>
                        <button
                          className="btn-action"
                          onClick={() => {
                            const next = new Set(expanded);
                            if (next.has(a._id)) next.delete(a._id);
                            else next.add(a._id);
                            setExpanded(next);
                          }}
                        >
                          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          {isExpanded ? "Hide diff" : "Show diff"}
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="col" style={{ gap: 12, marginTop: 12 }}>
                          <div className="card" style={{ background: "var(--bg-subtle)" }}>
                            <div className="card__head" style={{ padding: "6px 10px" }}>
                              <h3 className="card__title" style={{ fontSize: "var(--fs-sm)" }}>Redline</h3>
                            </div>
                            <div className="card__body" style={{ padding: 12 }}>
                              <DiffView oldText={a.baseText} newText={a.proposedText} />
                            </div>
                          </div>

                          <div className="card" style={{ background: "var(--bg-base)" }}>
                            <div className="card__head" style={{ padding: "6px 10px" }}>
                              <h3 className="card__title" style={{ fontSize: "var(--fs-sm)" }}>Lifecycle</h3>
                            </div>
                            <div className="card__body" style={{ padding: 12 }}>
                              <div className="timeline-vertical">
                                {a.history
                                  .slice()
                                  .reverse()
                                  .map((ev: any, j: number) => (
                                    <div className="timeline-vertical__item" key={j}>
                                      <span className="timeline-vertical__dot" style={{ borderColor: eventColor(ev.action) }} />
                                      <div className="row">
                                        <span className="mono muted" style={{ fontSize: "var(--fs-sm)" }}>{formatDateTime(ev.atISO)}</span>
                                        <Badge tone={eventTone(ev.action)}>
                                          {eventIcon(ev.action)} {eventLabel(ev.action)}
                                        </Badge>
                                      </div>
                                      <div className="timeline-vertical__title"><strong>{ev.actor}</strong></div>
                                      {ev.note && <div className="timeline-vertical__desc">{ev.note}</div>}
                                    </div>
                                  ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {withdrawn.length > 0 && (
            <>
              <div className="spacer-6" />
              <div className="card">
                <div className="card__head"><h2 className="card__title">Withdrawn / superseded</h2></div>
                <div className="card__body col" style={{ gap: 6 }}>
                  {withdrawn.map((a: any) => (
                    <div key={a._id} className="row" style={{ padding: 8, border: "1px solid var(--border)", borderRadius: 6 }}>
                      <span className="muted mono" style={{ fontSize: "var(--fs-sm)" }}>
                        {formatDate(a.updatedAtISO)}
                      </span>
                      <strong style={{ flex: 1 }}>{a.title}</strong>
                      <Badge tone="danger">{statusLabel(a.status)}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value" style={{ fontSize: 20 }}>{value}</div>
      {sub && <div className="stat__sub">{sub}</div>}
    </div>
  );
}

function statusLabel(s: string): string {
  switch (s) {
    case "Draft": return "Draft";
    case "Consultation": return "In consultation";
    case "ResolutionPassed": return "Resolution passed";
    case "Filed": return "Filed";
    case "Withdrawn": return "Withdrawn";
    case "Superseded": return "Superseded";
    default: return s;
  }
}
function statusTone(s: string): any {
  if (s === "Filed" || s === "ResolutionPassed") return "success";
  if (s === "Withdrawn" || s === "Superseded") return "danger";
  if (s === "Consultation") return "warn";
  return "accent";
}
function StatusIcon({ status }: { status: string }) {
  if (status === "Draft") return <PenLine size={14} style={{ color: "var(--accent)" }} />;
  if (status === "Consultation") return <MessageSquare size={14} style={{ color: "var(--warn)" }} />;
  if (status === "ResolutionPassed") return <CheckCircle2 size={14} style={{ color: "var(--success)" }} />;
  return <Flag size={14} />;
}

function eventLabel(action: string): string {
  switch (action) {
    case "created": return "Draft created";
    case "edited": return "Edited";
    case "consultation_started": return "Consultation started";
    case "resolution_passed": return "Resolution passed";
    case "filed": return "Filed";
    case "withdrawn": return "Withdrawn";
    default: return action;
  }
}
function eventTone(action: string): any {
  if (action === "resolution_passed" || action === "filed") return "success";
  if (action === "consultation_started") return "warn";
  if (action === "withdrawn") return "danger";
  return "accent";
}
function eventColor(action: string): string {
  if (action === "resolution_passed" || action === "filed") return "var(--success)";
  if (action === "consultation_started") return "var(--warn)";
  if (action === "withdrawn") return "var(--danger)";
  return "var(--accent)";
}
function eventIcon(action: string) {
  const size = 10;
  if (action === "consultation_started") return <MessageSquare size={size} />;
  if (action === "resolution_passed") return <ClipboardCheck size={size} />;
  if (action === "filed") return <Flag size={size} />;
  if (action === "withdrawn") return <Undo2 size={size} />;
  return <PenLine size={size} />;
}
