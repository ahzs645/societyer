import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Field } from "../components/ui";
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
} from "lucide-react";
import { formatDateTime, formatDate, relative } from "../lib/format";
import { exportWordDoc, escapeHtml } from "../lib/exportWord";

// Word-level diff reused from BylawDiff (inline so we don't couple the pages)
type Chunk = { kind: "same" | "add" | "del"; text: string };

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

function countDiff(oldText: string, newText: string): { adds: number; dels: number } {
  const chunks = diff(tokenize(oldText), tokenize(newText));
  let adds = 0, dels = 0;
  for (const c of chunks) {
    if (c.kind === "add") adds += c.text.trim() ? 1 : 0;
    if (c.kind === "del") dels += c.text.trim() ? 1 : 0;
  }
  return { adds, dels };
}

function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const chunks = useMemo(() => diff(tokenize(oldText), tokenize(newText)), [oldText, newText]);
  return (
    <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, fontSize: "var(--fs-md)" }}>
      {chunks.map((c, i) => {
        if (c.kind === "same") return <span key={i}>{c.text}</span>;
        if (c.kind === "add") return <span key={i} style={{ background: "#d4f4dd", color: "#0a5e32" }}>{c.text}</span>;
        return <span key={i} style={{ background: "#fde1e6", color: "#9b1c3a", textDecoration: "line-through" }}>{c.text}</span>;
      })}
    </div>
  );
}

// ============================================================================

type View = "timeline" | "current";

export function BylawsHistoryPage() {
  const society = useSociety();
  const amendments = useQuery(
    api.bylawAmendments.list,
    society ? { societyId: society._id } : "skip",
  );

  const [view, setView] = useState<View>("timeline");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
                  const stats = countDiff(a.baseText, a.proposedText);
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
                        <span style={{ color: "var(--success)" }}>+{stats.adds}</span>{" "}
                        <span style={{ color: "var(--danger)" }}>−{stats.dels}</span>{" "}
                        words changed · consultation {a.consultationStartedAtISO ? formatDate(a.consultationStartedAtISO) : "—"} → resolution {a.resolutionPassedAtISO ? formatDate(a.resolutionPassedAtISO) : "—"}
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
