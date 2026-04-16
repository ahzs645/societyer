import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Id } from "../../convex/_generated/dataModel";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Field, Badge } from "../components/ui";
import { useToast } from "../components/Toast";
import { useConfirm, usePrompt, Modal } from "../components/Modal";
import {
  GitCompare,
  FileDown,
  Save,
  Send,
  CheckCircle2,
  Flag,
  Undo2,
  Plus,
  Archive,
  PenLine,
  MessageSquare,
  ClipboardCheck,
} from "lucide-react";
import { exportWordDoc, escapeHtml } from "../lib/exportWord";
import { formatDateTime, relative } from "../lib/format";

// ============================================================================
// Word-level diff — same as before, but extracted so we can reuse on timeline.
// ============================================================================

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

// ============================================================================
// Page
// ============================================================================

type Status = "Draft" | "Consultation" | "ResolutionPassed" | "Filed" | "Withdrawn" | "Superseded";

const STATUS_TONE: Record<string, "neutral" | "accent" | "warn" | "success" | "danger"> = {
  Draft: "accent",
  Consultation: "warn",
  ResolutionPassed: "success",
  Filed: "success",
  Withdrawn: "danger",
  Superseded: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  Draft: "Draft",
  Consultation: "In consultation",
  ResolutionPassed: "Resolution passed",
  Filed: "Filed",
  Withdrawn: "Withdrawn",
  Superseded: "Superseded",
};

export function BylawDiffPage() {
  const society = useSociety();
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [voteModal, setVoteModal] = useState<{ f: string; a: string; x: string } | null>(null);
  const amendments = useQuery(
    api.bylawAmendments.list,
    society ? { societyId: society._id } : "skip",
  );
  const createDraft = useMutation(api.bylawAmendments.createDraft);
  const updateDraft = useMutation(api.bylawAmendments.updateDraft);
  const startConsultation = useMutation(api.bylawAmendments.startConsultation);
  const markResolutionPassed = useMutation(api.bylawAmendments.markResolutionPassed);
  const markFiled = useMutation(api.bylawAmendments.markFiled);
  const withdraw = useMutation(api.bylawAmendments.withdraw);
  const remove = useMutation(api.bylawAmendments.remove);

  const [selectedId, setSelectedId] = useState<Id<"bylawAmendments"> | null>(null);
  const [title, setTitle] = useState("");
  const [oldText, setOldText] = useState("");
  const [newText, setNewText] = useState("");
  const [dirty, setDirty] = useState(false);

  // Reset form when selecting a different amendment.
  useEffect(() => {
    if (!amendments) return;
    if (selectedId == null) return;
    const row = amendments.find((a: any) => a._id === selectedId);
    if (!row) return;
    setTitle(row.title);
    setOldText(row.baseText);
    setNewText(row.proposedText);
    setDirty(false);
  }, [selectedId, amendments]);

  const selected = useMemo(
    () => amendments?.find((a: any) => a._id === selectedId) ?? null,
    [amendments, selectedId],
  );

  const chunks = useMemo(() => diff(tokenize(oldText), tokenize(newText)), [oldText, newText]);
  const stats = useMemo(() => {
    let adds = 0, dels = 0;
    for (const c of chunks) {
      if (c.kind === "add") adds += c.text.trim() ? 1 : 0;
      if (c.kind === "del") dels += c.text.trim() ? 1 : 0;
    }
    return { adds, dels };
  }, [chunks]);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const newDraft = () => {
    setSelectedId(null);
    setTitle("");
    setOldText("");
    setNewText("");
    setDirty(false);
  };

  const saveAsNewDraft = async () => {
    if (!title.trim()) {
      toast.warn("Add a title for this amendment first.");
      return;
    }
    const id = await createDraft({
      societyId: society._id,
      title: title.trim(),
      baseText: oldText,
      proposedText: newText,
    });
    setSelectedId(id as Id<"bylawAmendments">);
    setDirty(false);
    toast.success("Draft amendment saved");
  };

  const saveEdits = async () => {
    if (!selected) return;
    await updateDraft({
      id: selected._id,
      patch: { title, baseText: oldText, proposedText: newText },
    });
    setDirty(false);
    toast.success("Draft updated");
  };

  const exportRedline = () => {
    const bodyHtml = `
      <h1>Bylaw redline${title ? ` — ${escapeHtml(title)}` : ""}</h1>
      <p class="meta">Generated ${escapeHtml(new Date().toLocaleString())}</p>
      <p>${chunks.map((c) => {
        const t = escapeHtml(c.text);
        if (c.kind === "add") return `<span style="background:#d4f4dd;">${t}</span>`;
        if (c.kind === "del") return `<span style="background:#fde1e6; text-decoration:line-through;">${t}</span>`;
        return t;
      }).join("")}</p>
    `;
    exportWordDoc({ filename: `bylaw-redline${title ? `-${title.replace(/\W+/g, "-")}` : ""}.doc`, title: "Bylaw redline", bodyHtml });
  };

  const status = (selected?.status ?? "Draft") as Status;
  const isDraft = status === "Draft";

  return (
    <div className="page">
      <PageHeader
        title="Bylaw amendments"
        icon={<GitCompare size={16} />}
        iconColor="purple"
        subtitle="Draft, consult, pass and file bylaw amendments. Each draft keeps a full history of edits and lifecycle events."
        actions={
          <>
            <button className="btn-action" onClick={newDraft}><Plus size={12} /> New draft</button>
            <button className="btn-action" onClick={exportRedline} disabled={!oldText && !newText}>
              <FileDown size={12} /> Export redline
            </button>
            {selected && isDraft && (
              <button className="btn-action btn-action--primary" onClick={saveEdits} disabled={!dirty}>
                <Save size={12} /> {dirty ? "Save changes" : "Saved"}
              </button>
            )}
            {!selected && (oldText || newText) && (
              <button className="btn-action btn-action--primary" onClick={saveAsNewDraft}>
                <Save size={12} /> Save as draft
              </button>
            )}
          </>
        }
      />

      <div className="bylaw-layout">
        {/* History sidebar */}
        <aside className="card bylaw-history">
          <div className="card__head"><h2 className="card__title">History</h2></div>
          <div style={{ maxHeight: 560, overflow: "auto" }}>
            {(amendments ?? []).length === 0 && (
              <div className="muted" style={{ padding: 16, textAlign: "center" }}>
                No amendments yet. Draft one on the right.
              </div>
            )}
            {(amendments ?? [])
              .slice()
              .sort((a: any, b: any) => b.updatedAtISO.localeCompare(a.updatedAtISO))
              .map((a: any) => (
                <button
                  key={a._id}
                  onClick={() => setSelectedId(a._id)}
                  className="bylaw-history__item"
                  style={{
                    background: selectedId === a._id ? "var(--bg-active)" : "transparent",
                    borderLeftColor: selectedId === a._id ? "var(--accent)" : "transparent",
                  }}
                >
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
                    <strong style={{ fontSize: "var(--fs-sm)" }}>{a.title}</strong>
                    <Badge tone={STATUS_TONE[a.status] ?? "neutral"}>{STATUS_LABEL[a.status] ?? a.status}</Badge>
                  </div>
                  <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>
                    Updated {relative(a.updatedAtISO)} · {a.history.length} event{a.history.length === 1 ? "" : "s"}
                  </div>
                </button>
              ))}
          </div>
        </aside>

        {/* Editor + diff */}
        <div className="col" style={{ gap: 16 }}>
          {selected && (
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">{selected.title}</h2>
                <Badge tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status}</Badge>
                <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                  {status === "Draft" && (
                    <button
                      className="btn-action btn-action--primary"
                      onClick={async () => {
                        await startConsultation({ id: selected._id });
                        toast.success("Consultation started");
                      }}
                    >
                      <Send size={12} /> Start consultation
                    </button>
                  )}
                  {status === "Consultation" && (
                    <button
                      className="btn-action btn-action--primary"
                      onClick={() => setVoteModal({ f: "", a: "0", x: "0" })}
                    >
                      <ClipboardCheck size={12} /> Record resolution
                    </button>
                  )}
                  {status === "ResolutionPassed" && (
                    <button
                      className="btn-action btn-action--primary"
                      onClick={async () => {
                        const ok = await confirm({
                          title: "Mark bylaw amendment as filed?",
                          message: "Confirm the special resolution, final bylaw text, and registry filing evidence are captured in filings or documents before marking this amendment filed.",
                          confirmLabel: "Mark filed",
                          tone: "warn",
                        });
                        if (!ok) return;
                        await markFiled({ id: selected._id });
                        toast.success("Marked as filed");
                      }}
                    >
                      <Flag size={12} /> Mark filed
                    </button>
                  )}
                  {status !== "Filed" && status !== "Withdrawn" && (
                    <button
                      className="btn-action"
                      onClick={async () => {
                        const reason = await prompt({
                          title: "Withdraw amendment",
                          message: "Optionally record why it's being withdrawn.",
                          placeholder: "e.g. Superseded by a revised draft",
                          confirmLabel: "Withdraw",
                        });
                        if (reason === null) return;
                        await withdraw({ id: selected._id, reason: reason || undefined });
                        toast.info("Withdrawn");
                      }}
                    >
                      <Undo2 size={12} /> Withdraw
                    </button>
                  )}
                  {status === "Draft" && (
                    <button
                      className="btn-action"
                      onClick={async () => {
                        const ok = await confirm({
                          title: "Delete draft?",
                          message: "This amendment draft will be permanently removed.",
                          confirmLabel: "Delete",
                          tone: "danger",
                        });
                        if (!ok) return;
                        await remove({ id: selected._id });
                        setSelectedId(null);
                        toast.success("Draft deleted");
                      }}
                    >
                      <Archive size={12} /> Delete
                    </button>
                  )}
                </div>
              </div>
              <div className="card__body">
                <Field label="Title">
                  <input
                    className="input"
                    value={title}
                    disabled={!isDraft}
                    onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
                  />
                </Field>

                {selected.votesFor != null && (
                  <div className="muted" style={{ fontSize: "var(--fs-sm)", marginBottom: 8 }}>
                    Resolution vote: <strong>{selected.votesFor}</strong> for · <strong>{selected.votesAgainst ?? 0}</strong> against · <strong>{selected.abstentions ?? 0}</strong> abstain
                  </div>
                )}
                {!isDraft && (
                  <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                    Editing is locked once consultation begins. Withdraw to make further changes, or start a fresh draft that supersedes this one.
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="two-col">
            <Field label="Current bylaws">
              <textarea
                className="textarea"
                style={{ minHeight: 240, fontFamily: "var(--font-mono)", fontSize: "var(--fs-sm)" }}
                value={oldText}
                disabled={selected != null && !isDraft}
                onChange={(e) => { setOldText(e.target.value); setDirty(true); }}
                placeholder="Paste the current bylaws section here…"
              />
            </Field>
            <Field label="Proposed bylaws">
              <textarea
                className="textarea"
                style={{ minHeight: 240, fontFamily: "var(--font-mono)", fontSize: "var(--fs-sm)" }}
                value={newText}
                disabled={selected != null && !isDraft}
                onChange={(e) => { setNewText(e.target.value); setDirty(true); }}
                placeholder="Paste the proposed replacement text here…"
              />
            </Field>
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Redline</h2>
              <span className="card__subtitle">
                <Badge tone="success">+{stats.adds} additions</Badge>{" "}
                <Badge tone="danger">−{stats.dels} deletions</Badge>
              </span>
            </div>
            <div className="card__body">
              {chunks.length === 0 ? (
                <div className="muted">Paste text into both columns to see the diff.</div>
              ) : (
                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, fontSize: "var(--fs-md)" }}>
                  {chunks.map((c, i) => {
                    if (c.kind === "same") return <span key={i}>{c.text}</span>;
                    if (c.kind === "add")
                      return <span key={i} style={{ background: "#d4f4dd", color: "#0a5e32" }}>{c.text}</span>;
                    return <span key={i} style={{ background: "#fde1e6", color: "#9b1c3a", textDecoration: "line-through" }}>{c.text}</span>;
                  })}
                </div>
              )}
            </div>
          </div>

          {selected && (
            <div className="card">
              <div className="card__head"><h2 className="card__title">Timeline</h2></div>
              <div className="card__body">
                <div className="timeline-vertical">
                  {selected.history
                    .slice()
                    .reverse()
                    .map((ev: any, i: number) => {
                      const icon = eventIcon(ev.action);
                      return (
                        <div className="timeline-vertical__item" key={i}>
                          <span className="timeline-vertical__dot" style={{ borderColor: eventColor(ev.action) }} />
                          <div className="row">
                            <span className="mono muted" style={{ fontSize: "var(--fs-sm)" }}>{formatDateTime(ev.atISO)}</span>
                            <Badge tone={eventTone(ev.action)}>
                              {icon} {eventLabel(ev.action)}
                            </Badge>
                          </div>
                          <div className="timeline-vertical__title">
                            <strong>{ev.actor}</strong>
                          </div>
                          {ev.note && <div className="timeline-vertical__desc">{ev.note}</div>}
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={!!voteModal}
        onClose={() => setVoteModal(null)}
        title="Record resolution vote"
        width={380}
        footer={
          <>
            <button className="btn" onClick={() => setVoteModal(null)}>Cancel</button>
            <button
              className="btn btn--accent"
              disabled={!voteModal || !Number.isFinite(Number(voteModal.f)) || voteModal.f === ""}
              onClick={async () => {
                if (!voteModal || !selected) return;
                const f = Number(voteModal.f);
                const a = Number(voteModal.a) || 0;
                const x = Number(voteModal.x) || 0;
                if (!Number.isFinite(f)) return;
                await markResolutionPassed({
                  id: selected._id,
                  votesFor: f,
                  votesAgainst: a,
                  abstentions: x,
                });
                setVoteModal(null);
                toast.success(`Resolution passed — ${f}-${a}`);
              }}
            >
              Record
            </button>
          </>
        }
      >
        {voteModal && (
          <div className="row" style={{ gap: 12 }}>
            <Field label="Votes for">
              <input
                autoFocus
                className="input"
                type="number"
                min={0}
                value={voteModal.f}
                onChange={(e) => setVoteModal({ ...voteModal, f: e.target.value })}
              />
            </Field>
            <Field label="Against">
              <input
                className="input"
                type="number"
                min={0}
                value={voteModal.a}
                onChange={(e) => setVoteModal({ ...voteModal, a: e.target.value })}
              />
            </Field>
            <Field label="Abstentions">
              <input
                className="input"
                type="number"
                min={0}
                value={voteModal.x}
                onChange={(e) => setVoteModal({ ...voteModal, x: e.target.value })}
              />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
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
  switch (action) {
    case "created": return "accent";
    case "consultation_started": return "warn";
    case "resolution_passed":
    case "filed":
      return "success";
    case "withdrawn": return "danger";
    default: return "neutral";
  }
}

function eventColor(action: string): string {
  switch (action) {
    case "filed":
    case "resolution_passed":
      return "var(--success)";
    case "consultation_started":
      return "var(--warn)";
    case "withdrawn":
      return "var(--danger)";
    default:
      return "var(--accent)";
  }
}

function eventIcon(action: string) {
  const size = 10;
  switch (action) {
    case "created": return <PenLine size={size} />;
    case "edited": return <PenLine size={size} />;
    case "consultation_started": return <MessageSquare size={size} />;
    case "resolution_passed": return <CheckCircle2 size={size} />;
    case "filed": return <Flag size={size} />;
    case "withdrawn": return <Undo2 size={size} />;
    default: return null;
  }
}
