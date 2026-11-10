import {useEffect,useState} from 'react';
import {Select} from '../../../components/Select';
import current from '../data/bc-bid-current-types.json';
import reference from '../data/bc-bid-filter-reference.json';
import historical from '../data/bc-bid-historical-types.json';
import {BC_FILTER_KEYS, type BcBidSourceFilters} from '../../../../shared/bcBidSourceFilters';
export function BcBidFilters({filters,onChange}:{filters:BcBidSourceFilters;onChange:(patch:Record<string,string|null>)=>void}) {
 const [commodity,setCommodity]=useState(filters.commodityCode ?? '');
 useEffect(()=>setCommodity(filters.commodityCode ?? ''),[filters.commodityCode]);
 const select=(key:keyof BcBidSourceFilters,label:string,options:{value:string;label:string}[])=><label className="field" key={key}><span>{label}</span><Select aria-label={label} value={filters[key] ?? ''} onChange={value=>onChange({[key]:value || null,...(key==='historicalType' && value?{status:'all'}:{})})} clearable clearLabel="Any" searchable options={options}/></label>;
 return <details className="procurement-source-filters"><summary>BC Bid source filters{Object.keys(filters).length ? ` · ${Object.keys(filters).length} active` : ''}</summary><p className="small muted">All five filters combine. Missing source facts stay unknown. Historical types refer to April 2015–December 2022; current UNSPSC codes are separate from historical GSIN.</p><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:12,padding:'8px 0'}}>
 {select('currentType','Opportunity type',current.types.map(t=>({value:t.code,label:t.title})))}
 {select('industryCategory','Industry category',reference.industryCategories.map(t=>({value:t.title,label:t.title})))}
 {select('officialRegion','BC Bid region',reference.regions.map(t=>({value:t.code,label:`${t.title} · ${t.code}`})))}
 {select('historicalType','Historical opportunity type',historical.types.map(t=>({value:`reference-term:BCBID:historical-type:${t.code}`,label:`${t.code} · ${t.title}`})))}
 <form onSubmit={event=>{event.preventDefault();if(!commodity || /^\d{8}$/.test(commodity))onChange({commodityCode:commodity || null});}}><label className="field"><span>Goods &amp; services commodity (UNSPSC)</span><input aria-label="UNSPSC code" inputMode="numeric" pattern="[0-9]{8}" maxLength={8} placeholder="Eight-digit code" value={commodity} onChange={e=>setCommodity(e.target.value)}/></label><button className="btn btn--secondary btn--sm" type="submit">Apply commodity</button><p className="small muted">Includes descendants of a segment, family or class code.</p></form>
 </div><button className="btn btn--secondary btn--sm" onClick={()=>{setCommodity('');onChange(Object.fromEntries(BC_FILTER_KEYS.map(k=>[k,null])));}}>Clear BC Bid filters</button></details>;
}
