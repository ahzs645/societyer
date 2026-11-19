import { ArrowRight } from "lucide-react";
import { Badge } from "../../../components/ui";
import { Checkbox } from "../../../components/Controls";
import type { RegistryImportProposal, RegistryImportSelection, RegistryProposalField } from "../../../../shared/registryDocuments";
import { sourceText } from "./importModel";

function FieldRow({ field, selection, onChange }: {
  field: RegistryProposalField;
  selection: RegistryImportSelection;
  onChange: (selection: RegistryImportSelection) => void;
}) {
  const info = field.target.scope === "info";
  const selected = Boolean(selection.selected[field.id]);
  const choice = selection.choices?.[field.id] ?? 0;
  const display = field.conflict?.options[choice]?.display ?? field.display;
  const portalAccess = field.proposed.kind === "portalAccess";
  const toggle = (checked: boolean) => onChange({ ...selection, selected: { ...selection.selected, [field.id]: checked } });
  const choose = (index: number) => onChange({ ...selection, choices: { ...selection.choices, [field.id]: index } });
  const radioName = `registry-choice-${field.id}`;
  return (
    <li className={`registry-import__field${info ? " registry-import__field--info" : ""}`}>
      <div className="registry-import__field-head">
        {info
          ? <span className="registry-import__field-label">{field.label}</span>
          : <Checkbox checked={selected} onChange={toggle} label={field.label} />}
        {field.equalsCurrent && <Badge tone="success">Already recorded</Badge>}
        {field.conflict && <Badge tone="warn">Documents differ</Badge>}
        {info && <Badge>For reference</Badge>}
      </div>
      <div className="registry-import__change">
        {field.currentDisplay && !field.equalsCurrent && (
          <>
            <span className="registry-import__current">{field.currentDisplay}</span>
            <ArrowRight size={12} aria-label="becomes" />
          </>
        )}
        <span className="registry-import__proposed">{portalAccess ? `${selection.portalAccessName?.trim() || "Name needed"} · ${display}` : display}</span>
      </div>
      {portalAccess && selected && (
        <label className="registry-import__inline-field">
          <span className="muted">Name of the person with access (the mailbox owner)</span>
          <input className="input" value={selection.portalAccessName ?? ""} onChange={(event) => onChange({ ...selection, portalAccessName: event.target.value })} />
        </label>
      )}
      {field.conflict && (
        <fieldset className="registry-import__choices">
          <legend className="muted">{field.conflict.note}</legend>
          {field.conflict.options.map((option, index) => (
            <label key={index} className="registry-import__choice">
              <input type="radio" name={radioName} checked={choice === index} onChange={() => choose(index)} />
              <span>
                <span className="registry-import__choice-value">{option.display}</span>
                <span className="muted registry-import__source"> · {sourceText(option.sources)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {!field.conflict && field.sources.length > 0 && <div className="muted registry-import__source">From {sourceText(field.sources)}</div>}
    </li>
  );
}

/** The proposal's groups: each value with current → proposed, its source document, and a checkbox. */
export function ProposalFields({ proposal, selection, onChange }: {
  proposal: RegistryImportProposal;
  selection: RegistryImportSelection;
  onChange: (selection: RegistryImportSelection) => void;
}) {
  if (!proposal.groups.length) return <p className="muted">No profile facts were found in these documents.</p>;
  return (
    <>
      {proposal.groups.map((group) => {
        const applicable = group.fields.filter((field) => field.target.scope !== "info");
        const all = applicable.length > 0 && applicable.every((field) => selection.selected[field.id]);
        const setAll = (checked: boolean) => onChange({ ...selection, selected: { ...selection.selected, ...Object.fromEntries(applicable.map((field) => [field.id, checked])) } });
        return (
          <section key={group.key} className="registry-import__section" aria-labelledby={`registry-group-${group.key}`}>
            <div className="registry-import__section-head">
              <h3 className="registry-import__section-title" id={`registry-group-${group.key}`}>{group.label}</h3>
              {applicable.length > 1 && <button className="btn btn--ghost btn--sm" type="button" onClick={() => setAll(!all)}>{all ? "Clear all" : "Select all"}</button>}
            </div>
            <ul className="registry-import__fields">
              {group.fields.map((field) => <FieldRow key={field.id} field={field} selection={selection} onChange={onChange} />)}
            </ul>
          </section>
        );
      })}
    </>
  );
}
