import { useId, useState } from "react";
import { Check, ExternalLink, Search } from "lucide-react";
import { Drawer, Field } from "../../components/ui";
import {
  getNaicsSector, NAICS_ACTIVITY_GROUPS, NAICS_CANADA_SOURCE_URL, NAICS_CANADA_VERSION,
  searchNaicsSectors, sectorForNaicsCode,
  type NaicsActivityGroup, type NaicsSectorCode, type NaicsSectorSelection,
} from "../../../shared/naicsCanada2022";
import "./naics-sector.scss";

type Props = {
  value?: NaicsSectorSelection | null;
  detailedCode?: string;
  onChange: (selection: NaicsSectorSelection | null) => void;
  onCodeChange: (code: string) => void;
  disabled?: boolean;
};

export function NaicsSectorField({ value, detailedCode, onChange, onCodeChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const sector = getNaicsSector(value?.code);
  const existingSector = sectorForNaicsCode(detailedCode);
  const mismatch = sector && existingSector && sector.code !== existingSector.code;

  return <section className="card naics-sector" aria-label="Industry sector">
    <div className="card__head"><h2 className="card__title">Industry sector</h2></div>
    <div className="card__body">
      <p className="naics-sector__intro">Choose the sector that best describes your main activity. This optional profile detail can help personalize future tools.</p>
      <div className="naics-sector__summary">
        {sector ? <>
          <span className="naics-sector__edition">NAICS Canada {value?.version} · Sector {sector.code}</span>
          <strong>{sector.title}</strong>
          <p>{sector.description}</p>
        </> : <>
          <strong>No sector selected</strong>
          <p>Not sure where you fit? Explore examples and get help choosing.</p>
        </>}
      </div>
      <div className="naics-sector__actions">
        <button type="button" className="btn btn--accent btn--sm" disabled={disabled} onClick={() => setOpen(true)}>
          <Search size={14} aria-hidden="true" /> {sector ? "Change sector" : "Choose a sector"}
        </button>
        {sector && <button type="button" className="btn btn--ghost btn--sm" disabled={disabled} onClick={() => onChange(null)}>Clear sector</button>}
      </div>
      <p className="field__hint">Use Save changes to save your selection to this organization.</p>
      <details className="naics-sector__details" open={detailedCode ? true : undefined}>
        <summary>Already have a NAICS code?</summary>
        <Field label="NAICS code" hint="Keep an existing code here. Choosing a broad sector does not replace or verify this code.">
          <input className="input" value={detailedCode ?? ""} disabled={disabled} onChange={(event) => onCodeChange(event.target.value)} />
        </Field>
        {existingSector && !sector && <p className="field__hint">Its prefix points to {existingSector.title}. Open the chooser to review and confirm your sector.</p>}
      </details>
      {mismatch && <p className="naics-sector__notice" role="status">Your existing code points to {existingSector.title}, which differs from your selected sector. Review the code or sector before using them together.</p>}
    </div>
    {open && <SectorChooser
      currentCode={sector?.code}
      existingCode={detailedCode}
      disabled={disabled}
      onClose={() => setOpen(false)}
      onChoose={(code) => { onChange({ code, version: NAICS_CANADA_VERSION }); setOpen(false); }}
    />}
  </section>;
}

function SectorChooser({ currentCode, existingCode, onChoose, onClose, disabled }: {
  currentCode?: NaicsSectorCode;
  existingCode?: string;
  onChoose: (code: NaicsSectorCode) => void;
  onClose: () => void;
  disabled?: boolean;
}) {
  const groupId = useId();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<NaicsActivityGroup | "">("");
  const [help, setHelp] = useState(false);
  const [pendingCode, setPendingCode] = useState<NaicsSectorCode | "">(currentCode ?? "");
  const results = searchNaicsSectors(query, group);
  const pending = getNaicsSector(pendingCode);
  const existing = sectorForNaicsCode(existingCode);
  const reset = () => { setQuery(""); setGroup(""); };

  return <Drawer open title="Choose your industry sector" onClose={onClose} size="wide" className="naics-chooser" bodyClassName="naics-chooser__body"
    footer={<div className="naics-chooser__footer">
      <div aria-live="polite">{pending ? <><Check size={14} aria-hidden="true" /> <span>{pending.code} · {pending.title}</span></> : "Choose a sector to continue, or cancel to leave it blank."}</div>
      <div className="naics-sector__actions">
        <button type="button" className="btn btn--sm" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn--accent btn--sm" disabled={!pendingCode || disabled} onClick={() => { if (pendingCode) onChoose(pendingCode); }}>Use this sector</button>
      </div>
    </div>}
  >
    <p className="naics-sector__intro">Start with what your organization mainly does. These are the 20 broad sectors in NAICS Canada {NAICS_CANADA_VERSION}.</p>
    <button type="button" className="btn btn--sm" aria-expanded={help} aria-controls={`${groupId}-help`} onClick={() => setHelp(!help)}>{help ? "Hide choosing help" : "Help me choose"}</button>
    {help && <div id={`${groupId}-help`} className="naics-chooser__help">
      <ol>
        <li>Focus on your main economic activity. If you do several things, start with the activity contributing the most value; revenue can be a useful starting point.</li>
        <li>Classify what you provide. Online shops belong with retail; online teaching belongs with education. Being digital, a charity or a non-profit does not determine your sector.</li>
        <li>Compare the descriptions below. For example, publishing your own software usually points to 51; developing custom software for clients usually points to 54.</li>
      </ol>
      <fieldset className="naics-chooser__groups">
        <legend>What best describes your main activity?</legend>
        {[{ id: "", label: "All activities" }, ...NAICS_ACTIVITY_GROUPS].map((activity) => <label key={activity.id}>
          <input type="radio" name={`${groupId}-activity`} checked={group === activity.id} onChange={() => { setGroup(activity.id as NaicsActivityGroup | ""); setQuery(""); }} />
          <span>{activity.label}</span>
        </label>)}
      </fieldset>
    </div>}
    <Field label="Search sectors" hint="Try restaurant, childcare, software, online shop, or a NAICS code.">
      <input className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
    </Field>
    {existing && <button type="button" className="btn btn--ghost btn--sm naics-chooser__existing" onClick={() => { setGroup(""); setQuery(existing.code); }}>Explore sector {existing.code} from your existing code</button>}
    <div className="naics-chooser__result-head">
      <span className="muted" role="status">{results.length} {results.length === 1 ? "sector" : "sectors"}{query.trim() || group ? " matching your filters" : " to explore"}</span>
      {(query || group) && <button type="button" className="btn btn--ghost btn--sm" onClick={reset}>Show all sectors</button>}
    </div>
    {results.length ? <fieldset className="naics-chooser__results">
      <legend>Choose a primary sector</legend>
      {results.map((sector) => <label key={sector.code} className={`naics-chooser__option${pendingCode === sector.code ? " is-selected" : ""}`}>
        <input type="radio" name={`${groupId}-sector`} value={sector.code} checked={pendingCode === sector.code} disabled={disabled} onChange={() => setPendingCode(sector.code)} />
        <span>
          <span className="naics-chooser__option-title"><span className="mono">{sector.code}</span> <strong>{sector.title}</strong></span>
          <span className="naics-chooser__description">{sector.description}</span>
          <span className="naics-chooser__examples">Examples: {sector.examples}.</span>
        </span>
      </label>)}
    </fieldset> : <div className="naics-chooser__empty">
      <strong>No sectors match this search.</strong>
      <p>Try a simpler activity such as “cleaning” or “retail”, or browse all sectors. You can leave your sector blank and return later.</p>
      <button type="button" className="btn btn--sm" onClick={reset}>Show all sectors</button>
    </div>}
    <p className="naics-chooser__source">Sector codes and titles: <a href={NAICS_CANADA_SOURCE_URL} target="_blank" rel="noreferrer">Statistics Canada <ExternalLink size={12} aria-hidden="true" /></a>. Examples and choosing help are app guidance. This records a broad sector, not a verified six-digit industry code.</p>
  </Drawer>;
}
