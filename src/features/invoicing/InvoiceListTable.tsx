import type { ReactNode } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Checkbox } from "../../components/Controls";
import { Money } from "../../components/Money";
import { formatDate } from "../../lib/format";
import { InvoiceStatusPill, NeedsActionPill } from "./InvoiceStatusPill";
import { DEFAULT_INVOICE_LIST_VIEW, type InvoiceListView } from "../../../shared/billingPricing";
import type { InvoiceRow } from "./types";

type SortKey = InvoiceListView['sortKey'];
export function InvoiceListTable({ rows, columns, sort, selected, openId, onSort, onToggle, onSelectAll, onOpen }: {
  rows: InvoiceRow[]; columns: InvoiceListView['columns']; sort: {key:SortKey;dir:'asc'|'desc'}; selected:Set<string>; openId:string|null;
  onSort:(key:SortKey)=>void;onToggle:(id:string)=>void;onSelectAll:()=>void;onOpen:(id:string)=>void;
}) {
  const custom = JSON.stringify(columns) !== JSON.stringify(DEFAULT_INVOICE_LIST_VIEW.columns);
  const visible = columns.filter(column => column.visible), count = rows.filter(row => selected.has(row._id)).length;
  const content = (key: string, row: InvoiceRow): ReactNode => {
    switch (key) {
      case 'number': return <><button type="button" className="invoice-table__link" onClick={e => { e.stopPropagation(); onOpen(row._id); }}>{row.number}</button>{row.seriesId && <span className="invoice-table__tag" title={row.seriesName}>Recurring</span>}</>;
      case 'customer': return <><span className="invoice-table__name">{row.billToName}</span><span className="muted invoice-table__sub">{row.lines[0]?.item}{row.lines.length > 1 ? ` +${row.lines.length-1}` : ''}</span></>;
      case 'issueDate': return formatDate(row.issueDate);
      case 'dueDate': return formatDate(row.dueDate);
      case 'total': return <Money cents={row.totalCents} currency={row.currency} struck={row.status === 'void'} />;
      case 'balance': return row.status === 'void' || row.balanceCents === 0 ? <span className="muted">—</span> : <Money cents={row.balanceCents} currency={row.currency} />;
      case 'paid': return <Money cents={row.paidCents} currency={row.currency} />;
      case 'status': return <span className="invoice-status-cell"><InvoiceStatusPill status={row.status} daysOverdue={row.daysOverdue} partial={row.paidCents > 0} /><NeedsActionPill flags={row.needsAction} /></span>;
      case 'currency': return row.currency;
      case 'email': return row.billToEmail || '—';
      case 'reference': return row.reference || '—';
    }
  };
  return <div style={{overflowX:'auto'}}><table className={`table table--comfortable invoice-table invoice-table--list${custom ? " invoice-table--custom-view" : ""}`}><thead><tr>
    <th className="invoice-table__check"><Checkbox bare checked={rows.length > 0 && count === rows.length} indeterminate={count > 0 && count < rows.length} onChange={onSelectAll} ariaLabel="Select every invoice in this view" /></th>
    {visible.map(column => { const sortable = ['number','customer','issueDate','dueDate','total','balance'].includes(column.key), active = sort.key === column.key;
      return <th key={column.key} data-column={column.key} className={['total','balance','paid'].includes(column.key) ? 'num' : undefined} style={{width:column.width,minWidth:column.width}} aria-sort={sortable ? active ? sort.dir === 'asc' ? 'ascending' : 'descending' : 'none' : undefined}>{sortable ? <button className={`invoice-sort${active ? ' is-active' : ''}`} onClick={() => onSort(column.key as SortKey)}>{column.label}{active && (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</button> : column.label}</th>; })}
  </tr></thead><tbody>{rows.map(row => <tr key={row._id} className={[selected.has(row._id) ? 'is-selected' : '',row._id === openId ? 'is-open' : '',row.status === 'void' ? 'is-void' : ''].filter(Boolean).join(' ') || undefined} data-amounts={row.status !== 'void' && row.balanceCents !== 0 && row.balanceCents !== row.totalCents ? 'split' : 'single'} onClick={() => onOpen(row._id)}>
    <td className="invoice-table__check" onClick={e => e.stopPropagation()}><Checkbox bare checked={selected.has(row._id)} onChange={() => onToggle(row._id)} ariaLabel={`Select ${row.number}`} /></td>
    {visible.map(column => <td key={column.key} data-column={column.key} data-label={column.label} className={['total','balance','paid'].includes(column.key) ? 'num' : column.key === 'number' ? 'invoice-table__number' : column.key === 'customer' ? 'invoice-table__customer' : column.key === 'dueDate' && row.status === 'overdue' ? 'invoice-table__due--overdue' : undefined}>{content(column.key,row)}</td>)}
  </tr>)}</tbody></table></div>;
}
