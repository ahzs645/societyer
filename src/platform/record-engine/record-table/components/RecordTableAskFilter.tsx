import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AlertTriangle, CornerDownLeft, History, Search, Sparkles, X } from "lucide-react";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import { Segmented } from "@/components/primitives";
import { ShortcutHint } from "@/components/ShortcutHint";
import { clearPendingAsk, peekPendingAsk } from "@/lib/nlFilter/bridge";
import { canMergeFilters, combineFilterTrees, exampleQueries, readRecentQueries, type ApplyMode, type NlParseResult } from "@/lib/nlFilter";
import { useApplyAskFilter, useAskAi, useAskFilterModel, type AskAiRoute } from "./RecordTableAskFilterModel";
import type { ViewFilter, ViewFilterGroup } from "../../types";

/**
 * "Ask" box at the top of the filter editor: a plain-language request becomes
 * filter conditions, shown as chips to confirm before anything changes.
 * Enter previews, ⌘/Ctrl+Enter applies a fully understood request. Words the
 * parser couldn't use are always listed — nothing half-understood is applied
 * without the person choosing to.
 */
export function RecordTableAskFilter({
  onApplied,
  onEditAsFilters,
}: {
  onApplied: () => void;
  onEditAsFilters: (tree: { filters: ViewFilter[]; filterGroups: ViewFilterGroup[] }) => void;
}) {
  const tableId = useRecordTableState((s) => s.tableId);
  const hasFilters = useRecordTableState((s) => s.filters.length > 0);
  const handle = useRecordTableStoreHandle();
  const { fields, context, parse, recentScope } = useAskFilterModel();
  const apply = useApplyAskFilter();
  const aiModel = useAskAi();
  const [pending] = useState(() => peekPendingAsk(tableId));
  const [query, setQuery] = useState(pending?.query ?? "");
  const [result, setResult] = useState<NlParseResult | null>(() => (pending?.preview && pending.query ? parse(pending.query) : null));
  const [mode, setMode] = useState<ApplyMode>("merge");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [recents, setRecents] = useState<string[]>(() => readRecentQueries(recentScope));
  const inputRef = useRef<HTMLInputElement>(null);
  const aiAbort = useRef<AbortController | null>(null);
  const examples = useMemo(() => exampleQueries(fields, context), [fields, context]);
  const mergeable = canMergeFilters(handle.get());

  useEffect(() => {
    clearPendingAsk(tableId);
  }, [tableId]);

  useEffect(() => {
    if (!pending) return;
    // Opened from the toolbar or the command palette: focus once the palette has let go.
    const timer = window.setTimeout(() => {
      inputRef.current?.closest(".nl-filter")?.scrollIntoView({ block: "nearest" });
      inputRef.current?.focus({ preventScroll: true });
    }, 40);
    return () => window.clearTimeout(timer);
  }, [pending]);

  useEffect(() => () => aiAbort.current?.abort(), []);

  const preview = (text = query) => {
    setAiError(null);
    const next = parse(text);
    setResult(next.status === "empty" ? null : next);
    return next;
  };

  const effectiveMode: ApplyMode = hasFilters && mergeable ? mode : "replace";

  const commit = (parsed: NlParseResult) => {
    if (parsed.status !== "ok" && parsed.status !== "partial") return;
    apply(parsed, effectiveMode);
    setRecents(readRecentQueries(recentScope));
    onApplied();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      // The editor applies its conditions on Enter; the Ask box handles its own.
      event.preventDefault();
      event.stopPropagation();
      const parsed = preview();
      if ((event.metaKey || event.ctrlKey) && parsed.status === "ok") commit(parsed);
    } else if (event.key === "Escape" && (result || query)) {
      event.preventDefault();
      event.stopPropagation();
      setResult(null);
      setQuery("");
    }
  };

  const fillQuery = (text: string) => {
    setQuery(text);
    preview(text);
    inputRef.current?.focus();
  };

  const askAi = async () => {
    aiAbort.current?.abort();
    const controller = new AbortController();
    aiAbort.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    setAiBusy(true);
    setAiError(null);
    try {
      const reply = await aiModel.ask(query, controller.signal);
      if (!controller.signal.aborted) setResult(reply.status === "none" ? { ...reply, suggestions: examples } : reply);
    } catch (error) {
      if (!controller.signal.aborted || controller === aiAbort.current) {
        setAiError(error instanceof Error && error.name !== "AbortError" ? error.message : "The AI request didn't finish. Try again.");
      }
    } finally {
      window.clearTimeout(timeout);
      setAiBusy(false);
    }
  };

  const showHints = !result && !query.trim();

  return (
    <section className="nl-filter" aria-label="Ask to filter">
      <div className="nl-filter__bar">
        <Sparkles size={14} className="nl-filter__icon" aria-hidden="true" />
        <input
          ref={inputRef}
          className="nl-filter__input"
          type="text"
          value={query}
          placeholder={examples[0] ? `Ask, e.g. “${examples[0]}”` : "Ask, e.g. “this month”"}
          aria-label="Describe the records to show"
          aria-describedby={`${tableId}-ask-help`}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value);
            if (result) setResult(null);
          }}
          onKeyDown={onKeyDown}
        />
        {query && (
          <button type="button" className="nl-filter__clear" aria-label="Clear request" onClick={() => { setQuery(""); setResult(null); inputRef.current?.focus(); }}>
            <X size={13} />
          </button>
        )}
        <button type="button" className="nl-filter__go" disabled={!query.trim()} onClick={() => preview()}>
          <CornerDownLeft size={12} aria-hidden="true" />
          <span>Preview</span>
        </button>
      </div>
      <p id={`${tableId}-ask-help`} className="nl-filter__help">
        <span>Enter to preview</span>
        <span className="nl-filter__help-sep" aria-hidden="true">·</span>
        <span className="nl-filter__help-apply"><ShortcutHint keys={["Mod", "Enter"]} /> to apply</span>
      </p>

      {showHints && <AskHints examples={examples} recents={recents} onPick={fillQuery} />}

      {result && (
        <AskPreview
          result={result}
          hasFilters={hasFilters}
          mergeable={mergeable}
          mode={effectiveMode}
          onMode={setMode}
          aiRoute={aiModel.route}
          aiBusy={aiBusy}
          aiError={aiError}
          onAskAi={askAi}
          onSuggestion={fillQuery}
          onSearchInstead={() => {
            handle.get().setSearchTerm(result.query);
            onApplied();
          }}
          onEdit={() => {
            const state = handle.get();
            onEditAsFilters(combineFilterTrees({ filters: state.filters, filterGroups: state.filterGroups }, result, effectiveMode));
            setResult(null);
          }}
          onApply={() => commit(result)}
        />
      )}
    </section>
  );
}

function AskHints({ examples, recents, onPick }: { examples: string[]; recents: string[]; onPick: (text: string) => void }) {
  return (
    <div className="nl-filter__hints">
      {examples.length > 0 && (
        <div className="nl-filter__hint-row" role="group" aria-label="Examples">
          <span className="nl-filter__hint-label">Try</span>
          {examples.map((example) => (
            <button key={example} type="button" className="nl-filter__example" onClick={() => onPick(example)}>
              {example}
            </button>
          ))}
        </div>
      )}
      {recents.length > 0 && (
        <div className="nl-filter__hint-row" role="group" aria-label="Recent requests">
          <span className="nl-filter__hint-label">Recent</span>
          {recents.map((recent) => (
            <button key={recent} type="button" className="nl-filter__example nl-filter__example--recent" onClick={() => onPick(recent)}>
              <History size={11} aria-hidden="true" />
              {recent}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AskPreview({
  result,
  hasFilters,
  mergeable,
  mode,
  onMode,
  aiRoute,
  aiBusy,
  aiError,
  onAskAi,
  onSuggestion,
  onSearchInstead,
  onEdit,
  onApply,
}: {
  result: NlParseResult;
  hasFilters: boolean;
  mergeable: boolean;
  mode: ApplyMode;
  onMode: (mode: ApplyMode) => void;
  aiRoute: AskAiRoute;
  aiBusy: boolean;
  aiError: string | null;
  onAskAi: () => void;
  onSuggestion: (text: string) => void;
  onSearchInstead: () => void;
  onEdit: () => void;
  onApply: () => void;
}) {
  const understood = result.status === "ok" || result.status === "partial";
  const joiner = result.root?.operator === "or" ? "or" : "and";
  return (
    <div className={`nl-filter__preview nl-filter__preview--${result.status}`} role="status" aria-live="polite">
      {understood && (
        <>
          <div className="nl-filter__preview-label">
            {result.source === "ai" ? (
              <>
                <Sparkles size={12} aria-hidden="true" /> Suggested by AI — check before applying
              </>
            ) : (
              "Filter to"
            )}
          </div>
          <ul className="nl-filter__chips" aria-label="Conditions">
            {result.chips.map((chip, index) => (
              <li key={`${chip.text}-${index}`} className="nl-filter__chip-item">
                {index > 0 && <span className="nl-filter__join">{joiner}</span>}
                <span className="nl-filter__chip" title={chip.detail}>
                  <span className="nl-filter__chip-text">{chip.text}</span>
                  {chip.detail && <span className="nl-filter__chip-detail">{chip.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {result.status === "none" && <p className="nl-filter__none">Couldn&apos;t turn that into filters for this table.</p>}
      {result.ignored.length > 0 && (
        <p className="nl-filter__ignored">
          <AlertTriangle size={13} aria-hidden="true" />
          <span>
            Not used:{" "}
            {result.ignored.map((word, index) => (
              <mark key={`${word}-${index}`} className="nl-filter__ignored-word">{word}</mark>
            ))}
            {understood && <> — the filters above leave {result.ignored.length === 1 ? "it" : "them"} out.</>}
          </span>
        </p>
      )}
      {result.notes.map((note) => (
        <p key={note} className="nl-filter__note">{note}</p>
      ))}
      {aiError && <p className="nl-filter__note nl-filter__note--error" role="alert">{aiError}</p>}
      {result.status === "none" && result.suggestions.length > 0 && (
        <div className="nl-filter__hint-row" role="group" aria-label="Suggestions">
          <span className="nl-filter__hint-label">Try</span>
          {result.suggestions.map((suggestion) => (
            <button key={suggestion} type="button" className="nl-filter__example" onClick={() => onSuggestion(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>
      )}
      <div className="nl-filter__actions">
        {understood && hasFilters && mergeable && (
          <div className="nl-filter__mode" aria-label="How to combine with the current filters">
            <Segmented
              value={mode}
              onChange={onMode}
              items={[
                { id: "merge", label: "Add to current" },
                { id: "replace", label: "Replace current" },
              ]}
            />
          </div>
        )}
        <div className="nl-filter__buttons">
          {result.status === "none" && (
            <button type="button" className="record-table__secondary-btn nl-filter__btn" onClick={onSearchInstead}>
              <Search size={12} aria-hidden="true" /> Search for &ldquo;{result.query}&rdquo;
            </button>
          )}
          {aiRoute && result.status !== "ok" && result.source !== "ai" && (
            <button
              type="button"
              className="record-table__secondary-btn nl-filter__btn"
              onClick={onAskAi}
              disabled={aiBusy}
              aria-busy={aiBusy || undefined}
              title={aiRoute === "workspace" ? "Sends the column names and your request to the workspace AI provider — never any records." : "Sends the column names and your request to this device's AI provider — never any records."}
            >
              <Sparkles size={12} aria-hidden="true" /> {aiBusy ? "Asking…" : "Ask AI"}
            </button>
          )}
          {understood && (
            <button type="button" className="record-table__secondary-btn nl-filter__btn" onClick={onEdit}>
              Edit as filters
            </button>
          )}
          {understood && (
            <button type="button" className="record-table__primary-btn nl-filter__btn" onClick={onApply}>
              {result.status === "partial" ? "Apply anyway" : "Apply"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
