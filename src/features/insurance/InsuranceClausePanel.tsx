import { Modal } from "../../components/Modal";
import { Segmented } from "../../components/primitives";
import { InsuranceDialogAction } from "./InsuranceDialogAction";
import { Pencil } from "lucide-react";
import { FileDropZone } from "../../components/FileDropZone";
import { InfoPopover } from "../../components/InfoPopover";
import { PolicyEvidencePreview } from "./PolicyEvidencePreview";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../lib/convexApi";
import { usePermissions } from "../../hooks/usePermissions";
import { useDeviceAi } from "../../lib/localAi/useDeviceAi";
import {
  isLocalDataRuntime,
  isStaticDemoRuntime,
} from "../../lib/staticRuntime";
import { Badge, Field } from "../../components/ui";
import {
  coverageCodes,
  insuranceAmount,
  limitBases,
} from "../../../shared/insuranceRegister";
import {
  clauseKinds,
  evidenceSourceIssue,
  clausePrompt,
  emptyClause,
  proofStages,
  readClauseProposals,
  validateClause,
  type Clause,
  type CoverageCandidate,
} from "../../../shared/insuranceClauses";
import {
  insuranceSourceParts,
  sourceChunks,
  type ClauseInput,
  type ClauseSource,
} from "./clauseSources";

type Origin = {
  societyId: string;
  origin: "procurement" | "agreement";
  originKey: string;
};
type Props = Origin & {
  inputs: ClauseInput[];
  contextVersion: string;
  defaultInsured: string;
};
type Draft = {
  key: string;
  clause: Clause;
  source: ClauseSource;
  id?: string;
  revision?: number;
  original?: string;
  proposalKey?: string;
  selected?: boolean;
};
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Could not complete the insurance check.";

export function InsuranceClausePanel(props: Props) {
  const { can } = usePermissions();
  const [visibility, setVisibility] = useState<"initial" | "open" | "closed">(
    "initial",
  );
  const open = visibility === "open";
  if (
    !can("financials:read") ||
    !can("documents:read") ||
    isStaticDemoRuntime()
  )
    return null;
  return (
    <section
      className="card insurance-clauses"
      aria-label="Insurance requirements"
    >
      <div className="card__head">
        <h2 className="card__title">Insurance requirements</h2>
        <button
          type="button"
          className="btn btn--sm"
          aria-haspopup="dialog"
          onClick={() => setVisibility("open")}
        >
          Check against register
        </button>
      </div>
      {visibility !== "initial" && (
        <>
          <ClauseWorkspace
            key={JSON.stringify([
              props.societyId,
              props.origin,
              props.originKey,
            ])}
            {...props}
            open={open}
            onClose={() => setVisibility("closed")}
            canWrite={
              can("financials:write") &&
              can(
                props.origin === "procurement"
                  ? "documents:write"
                  : "agreements:write",
              )
            }
          />
        </>
      )}
    </section>
  );
}

function ClauseWorkspace({
  societyId,
  origin,
  originKey,
  inputs,
  contextVersion,
  defaultInsured,
  canWrite,
  open,
  onClose,
}: Props & { canWrite: boolean; open: boolean; onClose: () => void }) {
  const [view, setView] = useState("Checks");
  const [editSuggestion, setEditSuggestion] = useState("");
  const target = { societyId, origin, originKey };
  const checks = useQuery(api.insurance.clauseChecksFor, target);
  const save = useMutation(api.insurance.saveClause);
  const ask = useAction(api.aiFilterActions.extractInsuranceClauses);
  const device = useDeviceAi("intake"),
    local = isLocalDataRuntime();
  const permissions = usePermissions();
  const aiAllowed = local ? device.ready : permissions.can("tasks:write");
  const [selection, select] = useState(inputs[0]?.key ?? "");
  const [pasted, paste] = useState("");
  const [citation, cite] = useState("");
  const [uploaded, setFile] = useState<ClauseInput>();
  const options = uploaded ? [...inputs, uploaded] : inputs;
  const selected = options.find((i) => i.key === selection);
  useEffect(() => {
    if (selection && !selected) select("");
  }, [selected, selection]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const aiCache = useRef(new Map<string, Clause[]>());
  const reviewed = useRef(new Set<string>());
  const suggestions = drafts.filter((d) => d.proposalKey);
  const selectedDrafts = suggestions.filter((d) => d.selected);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const versionFor = (s?: ClauseInput) => s?.version || contextVersion;
  const sourceFor = (
    input: ClauseInput | undefined,
    reference: string,
  ): ClauseSource => ({
    label: input?.label || "Pasted excerpt",
    reference,
    version: versionFor(input),
    ...(input
      ? {
          inputKey: input.key,
          ...(input.key !== "uploaded" ? { publication: contextVersion } : {}),
        }
      : {}),
  });
  async function addManual() {
    setBusy("Reading source");
    setMessage("");
    try {
      const parts = selected
        ? (selected.parts ?? (await selected.load?.()))
        : undefined;
      const original = parts?.map((p) => p.text).join("\n") || pasted.trim();
      const source = sourceFor(
        selected,
        citation.trim() || (parts?.length === 1 ? parts[0].location : ""),
      );
      setDrafts((rows) => [
        ...rows,
        {
          key: crypto.randomUUID(),
          original,
          source,
          clause: {
            ...emptyClause,
            quote: selected ? "" : pasted.trim(),
            namedInsured: defaultInsured,
          },
        },
      ]);
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy("");
    }
  }
  async function label() {
    setBusy("Finding insurance clauses");
    setMessage("");
    try {
      const parts = selected
        ? (selected.parts ?? (await selected.load?.()))
        : [{ text: pasted, location: citation || "Pasted excerpt" }];
      if (!parts?.some((p) => p.text.trim()))
        throw new Error("Choose a source or paste the insurance wording.");
      const chunks = sourceChunks(parts),
        proposals: Draft[] = [];
      for (const chunk of chunks) {
        if (!active.current) return;
        let result = aiCache.current.get(chunk.text);
        if (!result) {
          if (local) {
            const { deviceAiClient } = await import("../../lib/localAi/client");
            const prompt = clausePrompt(chunk.text);
            const reply = await deviceAiClient().completeText({
              messages: [
                { role: "system", content: prompt.system },
                { role: "user", content: prompt.user },
              ],
              maxTokens: 4000,
              temperature: 0,
            });
            result = readClauseProposals(reply, chunk.text);
          } else
            result = (await ask({ ...target, text: chunk.text })) as Clause[];
          aiCache.current.set(chunk.text, result);
        }
        for (const clause of result) {
          const start = chunk.text.indexOf(clause.quote),
            end = start + clause.quote.length;
          const refs = chunk.spans
            .filter((s) => s.start < end && s.end > start)
            .map((s) => s.location);
          const source = sourceFor(selected, [...new Set(refs)].join(" – "));
          const proposed = {
            ...clause,
            namedInsured: clause.namedInsured || defaultInsured,
          };
          const proposalKey = JSON.stringify([source, proposed]);
          if (!reviewed.current.has(proposalKey))
            proposals.push({
              key: proposalKey,
              proposalKey,
              original: chunk.text,
              clause: proposed,
              source,
            });
        }
      }
      if (active.current) {
        setDrafts((rows) => {
          const keys = new Set(rows.map((d) => d.key));
          const pending = proposals.filter((d) => {
            if (keys.has(d.key)) return false;
            keys.add(d.key);
            return !checks?.some(
              (r: any) =>
                r.source.inputKey === d.source.inputKey &&
                r.source.label === d.source.label &&
                r.source.version === d.source.version &&
                r.source.reference === d.source.reference &&
                Object.entries(d.clause).every(
                  ([key, value]) => r.clause[key] === value,
                ),
            );
          });
          return [...rows, ...pending];
        });
        if (!proposals.length)
          setMessage("No new insurance clauses in this source.");
      }
    } catch (e) {
      if (active.current) setMessage(errorText(e));
    } finally {
      if (active.current) setBusy("");
    }
  }
  async function keep(rows: Draft[]) {
    setBusy("Saving reviewed clauses");
    setMessage("");
    try {
      for (const d of rows) {
        validateClause(d.clause);
        if (!d.source.label.trim() || !d.source.reference.trim())
          throw new Error("Give the source and its page or section.");
        if (d.original && !d.original.includes(d.clause.quote))
          throw new Error("Use the exact wording from the selected source.");
      }
      for (const d of rows) {
        await save({
          ...target,
          clause: d.clause,
          source: d.source,
          ...(d.id ? { id: d.id, revision: d.revision } : {}),
        });
        if (d.proposalKey) reviewed.current.add(d.proposalKey);
        setDrafts((current) => current.filter((x) => x.key !== d.key));
      }
      setEditSuggestion("");
      if (drafts.every((d) => rows.some((saved) => saved.key === d.key)))
        setView("Checks");
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy("");
    }
  }
  const change = (d: Draft) =>
    setDrafts((rows) => rows.map((x) => (x.key === d.key ? d : x)));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Insurance requirements"
      size="lg"
      resizable={false}
    >
      <div className="insurance-check-workspace col" style={{ gap: 14 }}>
        {canWrite && (
          <Segmented
            className="insurance-segments"
            aria-label="Requirement views"
            value={view}
            onChange={setView}
            items={[
              { id: "Checks", label: "Checks" },
              { id: "Add requirements", label: "Add requirements" },
            ]}
          />
        )}
        {(view === "Checks" || !canWrite) &&
          (checks === undefined ? (
            <p role="status">Loading insurance checks…</p>
          ) : checks.length === 0 ? (
            <p>
              No reviewed insurance clauses for this{" "}
              {origin === "procurement" ? "bid" : "agreement"}.
            </p>
          ) : (
            checks.map((row: any) => {
              const available = options.find(
                (s) =>
                  s.key === row.source.inputKey &&
                  (s.key !== "uploaded" || s.label === row.source.label),
              );
              const changed = Boolean(
                (available && versionFor(available) !== row.source.version) ||
                (!available &&
                  row.source.publication &&
                  row.source.publication !== contextVersion),
              );
              return (
                <article key={row._id} className="insurance-clause">
                  <div className="insurance-clause__head">
                    <div className="insurance-clause__identity">
                      <strong>
                        {
                          clauseKinds[
                            row.clause.kind as keyof typeof clauseKinds
                          ]
                        }
                      </strong>
                      <Badge
                        tone={
                          changed
                            ? "warn"
                            : row.status === "Evidence confirmed"
                              ? "success"
                              : row.status === "Below required limit"
                                ? "danger"
                                : "warn"
                        }
                      >
                        {changed ? "Source changed · review again" : row.status}
                      </Badge>
                    </div>
                    <ClauseComparison
                      clause={row.clause}
                      candidates={row.candidates}
                    />
                    {canWrite && (
                      <button
                        type="button"
                        className="btn btn--ghost insurance-clause__edit"
                        aria-label="Edit reviewed clause"
                        title="Edit reviewed clause"
                        disabled={
                          !!busy || drafts.some((d) => d.id === row._id)
                        }
                        onClick={async () => {
                          setBusy("Opening clause");
                          setMessage("");
                          try {
                            if (changed && !available)
                              throw new Error(
                                "Select the current source document in its document list to review this clause.",
                              );
                            const original =
                              changed && available
                                ? (
                                    available.parts ??
                                    (await available.load?.())
                                  )
                                    ?.map((part) => part.text)
                                    .join("\n")
                                : undefined;
                            setView("Add requirements");
                            setEditSuggestion("");
                            setDrafts((ds) => [
                              ...ds,
                              {
                                key: row._id,
                                id: row._id,
                                revision: row.revision,
                                original,
                                clause: { ...row.clause },
                                source: changed
                                  ? sourceFor(available, row.source.reference)
                                  : row.source,
                              },
                            ]);
                          } catch (e) {
                            setMessage(errorText(e));
                          } finally {
                            setBusy("");
                          }
                        }}
                      >
                        <Pencil size={15} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  <blockquote>{row.clause.quote}</blockquote>
                  <div className="insurance-clause__meta">
                    <span>
                      {[row.source.label, row.source.reference]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {row.clause.stage && row.clause.stage !== "Unspecified" && (
                      <span>Evidence stage {row.clause.stage}</span>
                    )}
                    {row.clause.dueDate && (
                      <strong>Due {row.clause.dueDate}</strong>
                    )}
                  </div>
                  {row.proof && (
                    <InsuranceDialogAction label="Reviewed evidence">
                      <PolicyEvidencePreview
                        versionId={row.proof.versionId}
                        label={
                          row.proof.documentTitle
                            ? `Reviewed original · ${row.proof.documentTitle}`
                            : "Reviewed original"
                        }
                      />
                      <p>
                        {[row.proof.citation, row.proof.wording]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </InsuranceDialogAction>
                  )}
                  {canWrite &&
                    !changed &&
                    row.status !== "Evidence confirmed" &&
                    row.candidates.some(
                      (c: CoverageCandidate) => !c.below && !c.issues.length,
                    ) && (
                      <EvidenceReview
                        key={row.revision}
                        target={target}
                        row={row}
                      />
                    )}
                </article>
              );
            })
          ))}
        {canWrite && view === "Add requirements" && (
          <>
            {!editSuggestion && (
              <div className="col" style={{ gap: 10 }}>
                <Field label="Source for insurance clauses">
                  <select
                    className="input"
                    disabled={!!busy}
                    value={selection}
                    onChange={(e) => {
                      select(e.target.value);
                      setMessage("");
                    }}
                  >
                    <option value="">Paste an excerpt</option>
                    {options.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <FileDropZone
                  ariaLabel="Read a source file"
                  accept=".pdf,.docx,.txt"
                  className="insurance-upload"
                  title={uploaded?.label || "Source document"}
                  hint="PDF, DOCX or TXT"
                  chooseLabel={uploaded ? "Replace file" : "Choose file"}
                  disabled={!!busy}
                  onFiles={async ([file]) => {
                    setBusy("Reading file");
                    setMessage("");
                    try {
                      const bytes = await file.arrayBuffer();
                      const parts = await insuranceSourceParts(
                        file.name,
                        bytes,
                      );
                      const hash = await crypto.subtle.digest("SHA-256", bytes);
                      const version = Array.from(new Uint8Array(hash), (b) =>
                        b.toString(16).padStart(2, "0"),
                      ).join("");
                      setFile({
                        key: "uploaded",
                        label: file.name,
                        version,
                        parts,
                      });
                      select("uploaded");
                    } catch (e) {
                      setMessage(errorText(e));
                    } finally {
                      setBusy("");
                    }
                  }}
                />
                {!selection && (
                  <Field label="Original bid or agreement wording">
                    <textarea
                      className="input"
                      rows={4}
                      value={pasted}
                      onChange={(e) => paste(e.target.value)}
                    />
                  </Field>
                )}
                <Field label="Page or section for manual entry">
                  <input
                    className="input"
                    value={citation}
                    onChange={(e) => cite(e.target.value)}
                  />
                </Field>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={!!busy}
                    onClick={addManual}
                  >
                    Enter a clause
                  </button>
                  {aiAllowed && (
                    <button
                      type="button"
                      className="btn"
                      disabled={!!busy || (!selected && !pasted.trim())}
                      onClick={label}
                    >
                      Find clauses with AI
                    </button>
                  )}
                </div>
              </div>
            )}
            {!editSuggestion && suggestions.length > 1 && (
              <label>
                <input
                  type="checkbox"
                  disabled={!!busy}
                  checked={selectedDrafts.length === suggestions.length}
                  ref={(input) => {
                    if (input)
                      input.indeterminate =
                        selectedDrafts.length > 0 &&
                        selectedDrafts.length < suggestions.length;
                  }}
                  onChange={(e) => {
                    const selected = e.target.checked;
                    setDrafts((rows) =>
                      rows.map((d) => (d.proposalKey ? { ...d, selected } : d)),
                    );
                  }}
                />{" "}
                Select all suggestions
              </label>
            )}
            {drafts
              .filter((d) => !editSuggestion || d.key === editSuggestion)
              .map((d) => (
                <fieldset
                  key={d.key}
                  disabled={!!busy}
                  className="card card__body col"
                  style={{ gap: 8 }}
                >
                  <legend>
                    {d.id
                      ? "Revise clause"
                      : d.proposalKey
                        ? "Suggested clause"
                        : "New clause"}
                  </legend>
                  {d.proposalKey && (
                    <>
                      <label>
                        <input
                          type="checkbox"
                          checked={!!d.selected}
                          onChange={(e) =>
                            change({ ...d, selected: e.target.checked })
                          }
                        />{" "}
                        {d.clause.quote}
                      </label>
                      <small>
                        {[
                          clauseKinds[d.clause.kind],
                          coverageCodes[d.clause.coverageCode],
                          d.clause.minimumCents != null &&
                            insuranceAmount(
                              d.clause.minimumCents,
                              d.clause.currency,
                            ),
                          d.clause.limitBasis,
                          d.clause.namedInsured,
                          d.clause.beneficiary,
                          d.clause.from,
                          d.clause.through,
                          d.clause.stage !== "Unspecified" && d.clause.stage,
                          d.clause.dueDate,
                          d.source.label,
                          d.source.reference,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </>
                  )}
                  {d.proposalKey && !editSuggestion ? (
                    <button
                      className="btn btn--sm"
                      type="button"
                      onClick={() => setEditSuggestion(d.key)}
                    >
                      Edit suggestion
                    </button>
                  ) : (
                    <>
                      {d.proposalKey && (
                        <button
                          className="btn btn--sm"
                          type="button"
                          onClick={() => setEditSuggestion("")}
                        >
                          Back to suggestions
                        </button>
                      )}
                      {d.original && (
                        <InsuranceDialogAction label="Read source text">
                          <div
                            style={{
                              whiteSpace: "pre-wrap",
                              maxHeight: 220,
                              overflow: "auto",
                            }}
                          >
                            {d.original}
                          </div>
                        </InsuranceDialogAction>
                      )}
                      <ClauseFields
                        value={d.clause}
                        change={(clause) => change({ ...d, clause })}
                      />
                      <Field label="Source document">
                        <input
                          className="input"
                          value={d.source.label}
                          onChange={(e) =>
                            change({
                              ...d,
                              source: { ...d.source, label: e.target.value },
                            })
                          }
                        />
                      </Field>
                      <Field label="Source page or section">
                        <input
                          className="input"
                          value={d.source.reference}
                          onChange={(e) =>
                            change({
                              ...d,
                              source: {
                                ...d.source,
                                reference: e.target.value,
                              },
                            })
                          }
                        />
                      </Field>
                      <div className="row">
                        <button
                          className="btn btn--accent"
                          onClick={() => keep([d])}
                        >
                          Save reviewed clause
                        </button>
                        <button
                          className="btn"
                          onClick={() => {
                            setDrafts((ds) =>
                              ds.filter((x) => x.key !== d.key),
                            );
                            setEditSuggestion("");
                          }}
                        >
                          Discard draft
                        </button>
                      </div>
                    </>
                  )}
                </fieldset>
              ))}
            {!editSuggestion && suggestions.length > 0 && (
              <div>
                <button
                  type="button"
                  disabled={!!busy || !selectedDrafts.length}
                  className="btn btn--accent"
                  onClick={() => keep(selectedDrafts)}
                >
                  Save selected
                  {selectedDrafts.length ? ` (${selectedDrafts.length})` : ""}
                </button>
              </div>
            )}
          </>
        )}
        {busy && <p role="status">{busy}…</p>}
        {message && <p role="status">{message}</p>}
      </div>
    </Modal>
  );
}

function ClauseComparison({
  clause,
  candidates,
}: {
  clause: Clause;
  candidates: CoverageCandidate[];
}) {
  // Lead with a line on the requested basis even when other lines carry a larger amount.
  const ordered = [...candidates].sort(
    (a, b) =>
      Number(a.issues.includes("Limit basis missing or different")) -
        Number(b.issues.includes("Limit basis missing or different")) ||
      a.issues.length - b.issues.length ||
      Number(a.below) - Number(b.below) ||
      (b.limitCents ?? -1) - (a.limitCents ?? -1),
  );
  function line(c: CoverageCandidate) {
    return (
      <div key={c.policyId + ":" + (c.lineId || c.label)}>
        <Link to={`/app/insurance/${c.policyId}`}>{c.label}</Link>
        <div>
          {[
            c.limitCents != null && insuranceAmount(c.limitCents, c.currency),
            c.basis,
            c.below && "Below required limit",
            ...c.issues,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
    );
  }
  const top = ordered[0];
  const required = [
    coverageCodes[clause.coverageCode],
    clause.minimumCents != null &&
      insuranceAmount(clause.minimumCents, clause.currency),
    clause.limitBasis,
    clause.namedInsured,
    clause.beneficiary,
    clause.from,
    clause.through,
  ]
    .filter(Boolean)
    .join(" · ");
  const hint = top
    ? [
        top.label,
        top.limitCents != null && insuranceAmount(top.limitCents, top.currency),
        top.basis,
        ...top.issues,
      ]
        .filter(Boolean)
        .join(" · ")
    : "No matching coverage on file";
  return (
    <InfoPopover label="Compare with insurance on file" hover hint={hint}>
      <div className="insurance-comparison">
        {required && (
          <div>
            <strong>Required</strong>
            <p>{required}</p>
          </div>
        )}
        <div>
          <strong>On file</strong>
          {top ? line(top) : <p>{hint}</p>}
        </div>
        {ordered.length > 1 && (
          <section>
            <strong>Other coverage lines ({ordered.length - 1})</strong>
            {ordered.slice(1).map(line)}
          </section>
        )}
      </div>
    </InfoPopover>
  );
}

function ClauseFields({
  value: c,
  change,
}: {
  value: Clause;
  change: (c: Clause) => void;
}) {
  const set = (key: keyof Clause, value: string | number | undefined) =>
    change({ ...c, [key]: value });
  return (
    <>
      <Field label="Quoted requirement">
        <textarea
          className="input"
          rows={3}
          value={c.quote}
          onChange={(e) => set("quote", e.target.value)}
        />
      </Field>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))",
          gap: 8,
        }}
      >
        <Field label="Individual test">
          <select
            className="input"
            value={c.kind}
            onChange={(e) => set("kind", e.target.value)}
          >
            {Object.entries(clauseKinds).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Coverage">
          <select
            className="input"
            value={c.coverageCode}
            onChange={(e) => set("coverageCode", e.target.value)}
          >
            <option value="">Unknown</option>
            {Object.entries(coverageCodes).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        {c.kind === "limit" && (
          <>
            <Field label="Required minimum (dollars)">
              <input
                className="input"
                type="number"
                min="0"
                step=".01"
                value={c.minimumCents == null ? "" : c.minimumCents / 100}
                onChange={(e) =>
                  set(
                    "minimumCents",
                    e.target.value === ""
                      ? undefined
                      : Math.round(Number(e.target.value) * 100),
                  )
                }
              />
            </Field>
            <Field label="Currency">
              <input
                className="input"
                maxLength={3}
                value={c.currency}
                onChange={(e) => set("currency", e.target.value.toUpperCase())}
              />
            </Field>
            <Field label="Limit basis">
              <select
                className="input"
                value={c.limitBasis}
                onChange={(e) => set("limitBasis", e.target.value)}
              >
                <option value="">Unknown</option>
                {limitBases.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </Field>
          </>
        )}
        <Field label="Insured legal entity to check">
          <input
            className="input"
            value={c.namedInsured}
            onChange={(e) => set("namedInsured", e.target.value)}
          />
        </Field>
        {(c.kind === "additionalInsured" || c.kind === "certificate") && (
          <Field label="Required party or recipient">
            <input
              className="input"
              value={c.beneficiary}
              onChange={(e) => set("beneficiary", e.target.value)}
            />
          </Field>
        )}
        {(
          [
            ["from", "Coverage required from"],
            ["through", "Coverage required through (inclusive)"],
            ["dueDate", "Evidence due date"],
          ] as const
        ).map(([key, label]) => (
          <Field key={key} label={label}>
            <input
              className="input"
              type="date"
              value={c[key]}
              onChange={(e) => set(key, e.target.value)}
            />
          </Field>
        ))}
        <Field label="Evidence stage">
          <select
            className="input"
            value={c.stage}
            onChange={(e) => set("stage", e.target.value)}
          >
            {proofStages.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>
    </>
  );
}

function EvidenceReview({ target, row }: { target: Origin; row: any }) {
  const [open, setOpen] = useState(false);
  const candidates: CoverageCandidate[] = row.candidates.filter(
    (c: CoverageCandidate) => !c.issues.length && !c.below,
  );
  const [index, pick] = useState("");
  const candidate = index === "" ? undefined : candidates[Number(index)];
  const policies = useQuery(
    api.insurance.list,
    open ? { societyId: target.societyId } : "skip",
  );
  const documents = useQuery(
    api.documents.listSummaries,
    open ? { societyId: target.societyId } : "skip",
  );
  const policy = policies?.find((p: any) => p._id === candidate?.policyId);
  const [documentId, setDoc] = useState("");
  const versions = useQuery(
    api.documentVersions.listForDocument,
    documentId ? { documentId } : "skip",
  );
  const latest = versions?.find((v: any) => v.isCurrent) ?? versions?.[0];
  const [opened, setOpened] = useState("");
  const [citation, cite] = useState(""),
    [wording, quote] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const confirm = useMutation(api.insurance.confirmClause);
  const sourceIssue =
    policy &&
    candidate &&
    latest &&
    evidenceSourceIssue(
      row.clause.kind,
      policy,
      candidate.lineId,
      documentId,
      latest,
    );
  return (
    <>
      <button
        className="btn btn--sm insurance-dialog-action"
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        Confirm supporting evidence
      </button>
      <Modal
        title="Confirm supporting evidence"
        size="md"
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
      >
        {open && (
          <>
            <Field label="Applicable policy line">
              <select
                className="input"
                value={index}
                onChange={(e) => {
                  pick(e.target.value);
                  setDoc("");
                  setOpened("");
                }}
              >
                <option value="">Select coverage</option>
                {candidates.map((c, i) => (
                  <option key={i} value={i}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Supporting original">
              <select
                className="input"
                value={documentId}
                onChange={(e) => {
                  setDoc(e.target.value);
                  setOpened("");
                  cite("");
                  quote("");
                }}
              >
                <option value="">Select document</option>
                {documents
                  ?.filter(
                    (d: any) =>
                      !d.inCameraWithheld &&
                      !d.externalReference &&
                      policy?.sourceDocumentIds?.includes(d._id) &&
                      candidate &&
                      !evidenceSourceIssue(
                        row.clause.kind,
                        policy,
                        candidate.lineId,
                        d._id,
                      ),
                  )
                  .map((d: any) => (
                    <option key={d._id} value={d._id}>
                      {d.title}
                    </option>
                  ))}
              </select>
            </Field>
            {latest && (
              <PolicyEvidencePreview
                versionId={latest._id}
                label={`Open supporting original · version ${latest.version}`}
                onRead={setOpened}
              />
            )}
            {sourceIssue && <p role="status">{sourceIssue}</p>}
            {versions?.length === 0 && (
              <p>Attach a version of the supporting original in Documents.</p>
            )}
            <Field label="Evidence page or section">
              <input
                className="input"
                value={citation}
                onChange={(e) => cite(e.target.value)}
              />
            </Field>
            <Field label="Policy wording supporting this test">
              <textarea
                className="input"
                value={wording}
                onChange={(e) => quote(e.target.value)}
              />
            </Field>
            <button
              className="btn"
              disabled={
                busy ||
                !!sourceIssue ||
                !candidate ||
                !opened ||
                opened !== latest?._id ||
                !citation.trim() ||
                !wording.trim()
              }
              onClick={async () => {
                if (!candidate) return;
                setBusy(true);
                setError("");
                try {
                  await confirm({
                    ...target,
                    id: row._id,
                    revision: row.revision,
                    policyId: candidate.policyId,
                    lineId: candidate.lineId,
                    documentId,
                    versionId: opened,
                    citation,
                    wording,
                  });
                } catch (e) {
                  setError(errorText(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Confirm evidence for this test
            </button>
            {error && <p role="alert">{error}</p>}
          </>
        )}
      </Modal>
    </>
  );
}
