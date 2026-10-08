import { useEffect, useMemo, useState } from "react";
import { calendarDateKey } from "../lib/calendarDates";
import { useQuery } from "convex/react";
import { usePermissions } from "../hooks/usePermissions";
import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { api } from "@/lib/convexApi";
import { Id } from "../../convex/_generated/dataModel";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { InfoPopover } from "../components/InfoPopover";
import { Field, Badge } from "../components/ui";
import { useToast } from "../components/Toast";
import { useConfirm, usePrompt, Modal } from "../components/Modal";
import { parseBylawSections, diffBylawSections } from "../lib/bylawSections";
import { SectionRedline } from "../components/SectionRedline";
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
import { exportWordDocx } from "../lib/docx";
import { escapeHtml } from "../lib/html";
import { formatDate, formatDateTime, relative } from "../lib/format";
import { evaluateSpecialResolution, SPECIAL_RESOLUTION_CITATION, voteCountProblems } from "../../shared/bylawGovernance";
import { useBylawRules } from "../hooks/useBylawRules";
import { Select } from "../components/Select";

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
  const permissions = usePermissions();
  const canWrite = permissions.loaded && permissions.can("documents:write");
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [voteModal, setVoteModal] = useState<{ f: string; a: string; x: string; date: string; meetingId: string } | null>(null);
  const { rules } = useBylawRules();
  const meetings = useQuery(api.meetings.list, society ? { societyId: society._id } : "skip") as any[] | undefined;
  const amendments = useQuery(
    api.bylawAmendments.list,
    society ? { societyId: society._id } : "skip",
  );
  const createDraft = usePermissionedMutation(api.bylawAmendments.createDraft, canWrite);
  const updateDraft = usePermissionedMutation(api.bylawAmendments.updateDraft, canWrite);
  const startConsultation = usePermissionedMutation(api.bylawAmendments.startConsultation, canWrite);
  const markResolutionPassed = usePermissionedMutation(api.bylawAmendments.markResolutionPassed, canWrite);
  const markFiled = usePermissionedMutation(api.bylawAmendments.markFiled, canWrite);
  const withdraw = usePermissionedMutation(api.bylawAmendments.withdraw, canWrite);
  const supersede = usePermissionedMutation(api.bylawAmendments.supersede, canWrite);
  const materializeSections = usePermissionedMutation(api.bylawAmendments.materializeSections, canWrite);
  const remove = usePermissionedMutation(api.bylawAmendments.remove, canWrite);

  const [selectedId, setSelectedId] = useState<Id<"bylawAmendments"> | null>(null);
  const [title, setTitle] = useState("");
  const [oldText, setOldText] = useState("");
  const [newText, setNewText] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!canWrite) setVoteModal(null);
  }, [canWrite]);

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

  // Section-aware redline: align clauses by normalized heading and word-diff
  // each matched pair independently, so re-ordering or re-OCRing a page reads as
  // "moved, unchanged" rather than a whole-document rewrite.
  const sectionDiffs = useMemo(() => diffBylawSections(oldText, newText), [oldText, newText]);
  const storedSections = useQuery(
    api.bylawAmendments.sectionsForAmendment,
    selectedId ? { amendmentId: selectedId } : "skip",
  );
  const sectionStats = useMemo(() => {
    let adds = 0, dels = 0, changed = 0, added = 0, removed = 0, moved = 0;
    for (const d of sectionDiffs) {
      adds += d.adds;
      dels += d.dels;
      if (d.status === "changed") changed += 1;
      if (d.status === "added") added += 1;
      if (d.status === "removed") removed += 1;
      if (d.status === "moved") moved += 1;
    }
    return { adds, dels, changed, added, removed, moved };
  }, [sectionDiffs]);
  const hasChanges = sectionDiffs.some((d) => d.status !== "unchanged");

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const newDraft = () => {
    if (!canWrite) return;
    setSelectedId(null);
    setTitle("");
    setOldText("");
    setNewText("");
    setDirty(false);
  };

  const saveAsNewDraft = async () => {
    if (!canWrite) return;
    if (!title.trim()) {
      toast.warn("Add a title for this amendment first.");
      return;
    }
    try {
      const id = await createDraft({
        societyId: society._id,
        title: title.trim(),
        baseText: oldText,
        proposedText: newText,
      });
      setSelectedId(id as Id<"bylawAmendments">);
      setDirty(false);
      toast.success("Draft amendment saved");
    } catch (error) {
      toast.error("Could not save the draft", error instanceof Error ? error.message : String(error));
    }
  };

  const saveEdits = async () => {
    if (!canWrite) return;
    if (!selected) return;
    if (!title.trim()) {
      toast.warn("The amendment needs a title.");
      return;
    }
    try {
      await updateDraft({
        id: selected._id,
        patch: { title: title.trim(), baseText: oldText, proposedText: newText },
      });
      setDirty(false);
      toast.success("Draft updated");
    } catch (error) {
      toast.error("Could not update the draft", error instanceof Error ? error.message : String(error));
    }
  };

  const exportRedline = () => {
    const sectionsHtml = sectionDiffs
      .filter((d) => d.status !== "unchanged")
      .map((d) => {
        const heading = `<h2>${escapeHtml(d.heading)} <em>(${d.status === "moved" ? "moved, unchanged" : d.status})</em></h2>`;
        if (d.status === "moved") return `${heading}<p class="meta">Relocated without textual changes.</p>`;
        if (d.tooLarge) return `${heading}<p class="meta">Section too large for an inline redline.</p>`;
        const body = d.chunks
          .map((c) => {
            const t = escapeHtml(c.text);
            if (c.kind === "add") return `<span style="background:#d4f4dd; margin:0 1px;">${t}</span>`;
            if (c.kind === "del") return `<span style="background:#fde1e6; text-decoration:line-through; margin:0 1px;">${t}</span>`;
            return t;
          })
          .join("");
        return `${heading}<p>${body}</p>`;
      })
      .join("");
    const bodyHtml = `
      <h1>Bylaw amendments${title ? ` — ${escapeHtml(title)}` : ""}</h1>
      <p class="meta">Generated ${escapeHtml(new Date().toLocaleString())}</p>
      ${sectionsHtml || "<p>No section-level changes.</p>"}
    `;
    void exportWordDocx({ filename: `bylaw-amendments${title ? `-${title.replace(/\W+/g, "-")}` : ""}.docx`, title: "Bylaw amendments", bodyHtml });
  };

  const generalMeetings = (meetings ?? []).filter((m: any) => m.type === "AGM" || m.type === "SGM" || m.type === "General" || /general meeting/i.test(String(m.title ?? "")));
  const toCount = (value: string) => (value === "" ? undefined : Number(value));
  const voteProblems = voteModal
    ? [
        ...voteCountProblems({ votesFor: toCount(voteModal.f), votesAgainst: toCount(voteModal.a || "0"), abstentions: toCount(voteModal.x || "0") }, { requireVotesFor: true }),
        ...(voteModal.date && voteModal.date > calendarDateKey(new Date()) ? ["The resolution date cannot be in the future."] : []),
      ]
    : [];
  const votePreview = voteModal && voteModal.f !== ""
    ? evaluateSpecialResolution({ votesFor: Number(voteModal.f), votesAgainst: Number(voteModal.a || 0) }, rules?.specialResolutionThresholdPct)
    : null;
  const status = (selected?.status ?? "Draft") as Status;
  const isDraft = status === "Draft";

  return (
    <div className="page">
      <PageHeader
        title="Bylaw amendments"
        icon={<GitCompare size={16} />}
        iconColor="purple"
        subtitle="Draft, consult, pass and file bylaw amendments."
        info={<p>Each draft keeps a full history of edits and lifecycle events.</p>}
        actions={
          <>
            {selected && <button className="btn-action" onClick={newDraft} disabled={!canWrite}><Plus size={12} /> New draft</button>}
            <button className="btn-action" onClick={exportRedline} disabled={!oldText && !newText}>
              <FileDown size={12} /> Export redline
            </button>
            {selected && isDraft && (
              <button className="btn-action btn-action--primary" onClick={saveEdits} disabled={!canWrite || !dirty}>
                <Save size={12} /> {dirty ? "Save changes" : "Saved"}
              </button>
            )}
            {!selected && (
              <button
                className="btn-action btn-action--primary"
                onClick={saveAsNewDraft}
                disabled={!canWrite || !title.trim() || (!oldText && !newText)}
                title={!title.trim() ? "Add a title first" : !oldText && !newText ? "Paste the current or proposed bylaw text first" : undefined}
              >
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
              <div className="empty-state">
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
          {!selected && (
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">New amendment draft</h2>
                <InfoPopover label="About amendment drafts">
                  <p>Paste the current and proposed text below, then save. The amendment then moves through consultation, a special resolution (at least two-thirds of votes cast) and filing.</p>
                </InfoPopover>
              </div>
              <div className="card__body">
                <Field label="Title" hint="Required. For example: 2026 quorum and electronic meeting amendments">
                  <input
                    className="input"
                    value={title}
                    disabled={!canWrite}
                    placeholder="Name this amendment"
                    aria-required="true"
                    onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
                  />
                </Field>
              </div>
            </div>
          )}
          {selected && (
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">{selected.title}</h2>
                <Badge tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status}</Badge>
                <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                  {status === "Draft" && (
                    <button
                      className="btn-action btn-action--primary"
                      disabled={!canWrite}
                      onClick={async () => {
                        if (!canWrite) return;
                        if (dirty) {
                          toast.warn("Save your changes before starting consultation.");
                          return;
                        }
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
                      disabled={!canWrite}
                      onClick={() => { if (canWrite) setVoteModal({ f: "", a: "0", x: "0", date: calendarDateKey(new Date()), meetingId: "" }); }}
                    >
                      <ClipboardCheck size={12} /> Record resolution
                    </button>
                  )}
                  {status === "ResolutionPassed" && (
                    <button
                      className="btn-action btn-action--primary"
                      disabled={!canWrite}
                      onClick={async () => {
                        if (!canWrite) return;
                        const ok = await confirm({
                          title: "Mark bylaw amendment as filed?",
                          message: "Confirm the special resolution, final bylaw text, and registry filing evidence are captured in filings or documents before marking this amendment filed.",
                          confirmLabel: "Mark filed",
                          tone: "warn",
                        });
                        if (!ok) return;
                        try {
                          await markFiled({ id: selected._id });
                          toast.success("Marked as filed", "Record a new bylaw rule version effective on the filing date (Bylaw rules) if the amendment changes meeting rules.");
                        } catch (error) {
                          toast.error("Could not mark filed", error instanceof Error ? error.message : String(error));
                        }
                      }}
                    >
                      <Flag size={12} /> Mark filed
                    </button>
                  )}
                  {status !== "Filed" && status !== "Withdrawn" && (
                    <button
                      className="btn-action"
                      disabled={!canWrite}
                      onClick={async () => {
                        if (!canWrite) return;
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
                  {status !== "Draft" && status !== "Withdrawn" && status !== "Superseded" && (
                    <button
                      className="btn-action"
                      disabled={!canWrite}
                      onClick={async () => {
                        if (!canWrite) return;
                        const reason = await prompt({
                          title: "Supersede amendment",
                          message: "Mark this amendment as superseded by a newer version.",
                          placeholder: "e.g. Replaced by the 2026 revised bylaws",
                          confirmLabel: "Supersede",
                        });
                        if (reason === null) return;
                        await supersede({ id: selected._id, reason: reason || undefined });
                        toast.info("Superseded");
                      }}
                    >
                      <Undo2 size={12} /> Supersede
                    </button>
                  )}
                  {status === "Draft" && (
                    <button
                      className="btn-action"
                      disabled={!canWrite}
                      onClick={async () => {
                        if (!canWrite) return;
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
                    disabled={!canWrite || !isDraft}
                    onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
                  />
                </Field>

                {selected.votesFor != null && (
                  <div className="muted" style={{ fontSize: "var(--fs-sm)", marginBottom: 8 }}>
                    Resolution vote: <strong>{selected.votesFor}</strong> for · <strong>{selected.votesAgainst ?? 0}</strong> against · <strong>{selected.abstentions ?? 0}</strong> abstain
                    {selected.resolutionPassedAtISO ? <> · passed {formatDate(String(selected.resolutionPassedAtISO).slice(0, 10))}</> : null}
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

          <div className="two-col bylaw-diff__editors">
            <Field label="Current bylaws">
              <textarea
                className="textarea textarea--mono"
                style={{ minHeight: 240 }}
                value={oldText}
                disabled={!canWrite || (selected != null && !isDraft)}
                onChange={(e) => { setOldText(e.target.value); setDirty(true); }}
                placeholder="Paste the current bylaws section here…"
              />
            </Field>
            <Field label="Proposed bylaws">
              <textarea
                className="textarea textarea--mono"
                style={{ minHeight: 240 }}
                value={newText}
                disabled={!canWrite || (selected != null && !isDraft)}
                onChange={(e) => { setNewText(e.target.value); setDirty(true); }}
                placeholder="Paste the proposed replacement text here…"
              />
            </Field>
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Redline</h2>
              {hasChanges && (
                <span className="card__subtitle">
                  <Badge tone="success">+{sectionStats.adds} additions</Badge>{" "}
                  <Badge tone="danger">−{sectionStats.dels} deletions</Badge>
                  {sectionStats.moved > 0 && (
                    <>
                      {" "}
                      <Badge tone="accent">{sectionStats.moved} moved</Badge>
                    </>
                  )}
                </span>
              )}
              {selected && hasChanges && (
                <button
                  className="btn-action"
                  style={{ marginLeft: "auto" }}
                  disabled={!canWrite}
                  onClick={async () => {
                    if (!canWrite) return;
                    const secs = parseBylawSections(newText).map((s) => ({
                      heading: s.heading,
                      key: s.key,
                      level: s.level,
                      body: s.body,
                    }));
                    const r = await materializeSections({ amendmentId: selected._id, sections: secs });
                    toast.success(`Saved ${r.stored} section${r.stored === 1 ? "" : "s"} as records`);
                  }}
                >
                  Save as sections
                </button>
              )}
            </div>
            <div className="card__body">
              {!oldText && !newText ? (
                <div className="muted">Paste text into both columns to see the diff.</div>
              ) : !hasChanges ? (
                <div className="muted">No section-level changes.</div>
              ) : (
                <>
                  <div className="muted" style={{ marginBottom: 10, fontSize: "var(--fs-sm)" }}>
                    {sectionStats.changed} changed · {sectionStats.added} added · {sectionStats.removed} removed ·{" "}
                    {sectionStats.moved} moved
                    {storedSections ? ` · ${storedSections.length} stored` : ""}
                  </div>
                  <SectionRedline diffs={sectionDiffs} />
                </>
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
        open={!!voteModal && canWrite}
        onClose={() => setVoteModal(null)}
        title="Record resolution vote"
        size="sm"
        footer={
          <>
            <button className="btn" onClick={() => setVoteModal(null)}>Cancel</button>
            <button
              className="btn btn--accent"
              disabled={!canWrite || !voteModal || voteProblems.length > 0}
              onClick={async () => {
                if (!canWrite) return;
                if (!voteModal || !selected || voteProblems.length) return;
                try {
                  const result = await markResolutionPassed({
                    id: selected._id,
                    votesFor: Number(voteModal.f),
                    votesAgainst: Number(voteModal.a || 0),
                    abstentions: Number(voteModal.x || 0),
                    resolutionDateISO: voteModal.date || undefined,
                    meetingId: (voteModal.meetingId || undefined) as any,
                  }) as any;
                  setVoteModal(null);
                  if (result && result.passed === false) {
                    toast.warn("Special resolution not passed", result.summary);
                  } else {
                    toast.success("Special resolution passed", result?.summary);
                  }
                } catch (error) {
                  toast.error("Could not record the vote", error instanceof Error ? error.message : String(error));
                }
              }}
            >
              {votePreview && !votePreview.passed && voteProblems.length === 0 ? "Record failed vote" : "Record"}
            </button>
          </>
        }
      >
        {voteModal && (
          <div className="col" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <Field label="Resolution date">
              <input
                className="input"
                type="date"
                max={calendarDateKey(new Date())}
                value={voteModal.date}
                onChange={(e) => setVoteModal({ ...voteModal, date: e.target.value })}
              />
            </Field>
            <Field label="General meeting (optional)">
              <Select
                value={voteModal.meetingId}
                onChange={(value) => {
                  const meeting = generalMeetings.find((m: any) => String(m._id) === value);
                  setVoteModal({ ...voteModal, meetingId: value, date: meeting ? String(meeting.scheduledAt).slice(0, 10) : voteModal.date });
                }}
                options={[{ value: "", label: "Not linked" }, ...generalMeetings.map((m: any) => ({ value: String(m._id), label: `${m.title} · ${String(m.scheduledAt).slice(0, 10)}` }))]}
              />
            </Field>
          </div>
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
          {voteProblems.length > 0 ? (
            <div className="muted" role="alert" style={{ color: "var(--danger)", fontSize: "var(--fs-sm)" }}>{voteProblems.join(" ")}</div>
          ) : votePreview ? (
            <div role="status" style={{ fontSize: "var(--fs-sm)" }}>
              <Badge tone={votePreview.passed ? "success" : "danger"}>{votePreview.passed ? "Passes" : "Does not pass"}</Badge>{" "}
              {votePreview.summary}
            </div>
          ) : null}
          <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>{SPECIAL_RESOLUTION_CITATION}. Abstentions are not votes cast.</div>
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
    case "resolution_failed": return "Resolution not passed";
    case "filed": return "Filed";
    case "withdrawn": return "Withdrawn";
    case "superseded": return "Superseded";
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
    case "withdrawn":
    case "resolution_failed":
      return "danger";
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
