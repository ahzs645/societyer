import { Field } from './ui';
import { Select } from './Select';
export type EvidenceColumn = { key: string; label: string; type?: 'text' | 'number' | 'date' | 'boolean' | 'list'; options?: string[]; /** Labelled choices (e.g. a record picker) stored by value. */ choices?: Array<{ value: string; label: string }>; /** Label of the blank choice (default "Not linked"). */ emptyLabel?: string };
export function EvidenceRowsEditor({ title, rows, columns, onChange, disabled = false }: { title: string; rows: any[]; columns: EvidenceColumn[]; onChange: (rows: any[]) => void; disabled?: boolean }) {
  return <div className="col" style={{ gap: 12 }}>
    <div className="row" style={{ justifyContent: 'space-between' }}><strong>{title}</strong><button type="button" className="btn-action" disabled={disabled} onClick={() => onChange([...rows, { id: crypto.randomUUID() }])}>Add row</button></div>
    {rows.map((row, index) => <fieldset key={row.id || index} disabled={disabled} style={{ border: '1px solid var(--border)', padding: 12, borderRadius: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}><span>Row {index + 1}</span><button type="button" className="btn-action" onClick={() => onChange(rows.filter((_, i) => i !== index))}>Remove</button></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        {columns.map(column => <Field key={column.key} label={column.label}>
          {column.type === 'boolean' ? <Select disabled={disabled} value={row[column.key] == null ? '' : String(row[column.key])} placeholder="Unknown / not recorded" clearable clearLabel="Unknown / not recorded"
              options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]}
              onChange={next => onChange(rows.map((value, i) => i === index ? { ...value, [column.key]: next === '' ? undefined : next === 'true' } : value))} />
            : column.choices ? <Select disabled={disabled} value={row[column.key] ?? ''} placeholder={column.emptyLabel ?? "Not linked"} clearable clearLabel={column.emptyLabel ?? "Not linked"}
              // A stored value no longer among the choices stays visible as itself.
              options={[...(row[column.key] && !column.choices.some(choice => choice.value === row[column.key]) ? [{ value: row[column.key], label: row[column.key] }] : []), ...column.choices]}
              onChange={next => onChange(rows.map((value, i) => i === index ? { ...value, [column.key]: next || undefined } : value))} />
            : column.options ? <Select disabled={disabled} value={row[column.key] ?? ''} placeholder="Unknown / not recorded" clearable clearLabel="Unknown / not recorded"
              options={column.options.map(option => ({ value: option, label: option }))}
              onChange={next => onChange(rows.map((value, i) => i === index ? { ...value, [column.key]: next || undefined } : value))} /> :
            <input className="input" type={column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'} value={column.type === 'list' ? (row[column.key] ?? []).join(', ') : row[column.key] ?? ''} onChange={event => onChange(rows.map((value, i) => i === index ? { ...value, [column.key]: event.target.value === '' ? undefined : column.type === 'number' ? Number(event.target.value) : column.type === 'list' ? event.target.value.split(',').map(item => item.trim()).filter(Boolean) : event.target.value } : value))} />}
        </Field>)}
      </div>
    </fieldset>)}
    {!rows.length && <p className="muted">No source observations recorded.</p>}
  </div>;
}
