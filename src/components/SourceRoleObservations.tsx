import {sourceRoleLabel} from '../../shared/personHistory';
import {Link} from 'react-router-dom';import {useQuery} from 'convex/react';import {api} from '@/lib/convexApi';import {usePermissions} from '@/hooks/usePermissions';

/** Roster observations whose role reads like a board seat (director/officer). */
export function isBoardSeatObservation(observation: any): boolean {
  const text = `${observation?.roleTitle ?? ''} ${observation?.context ?? ''}`.toLowerCase();
  return /director|board|president|chair|treasurer|secretary|vice/.test(text) && !/committee member|staff|observer/.test(text);
}

export function SourceRoleObservations({societyId, registerCount, onAddAsDirector}:{societyId:string; registerCount?: number; onAddAsDirector?: (observation: any) => void}){
 const {can}=usePermissions();const data=useQuery(api.personHistory.overview,can('members:read')&&can('directors:read')?{societyId}:'skip') as any;
 const observations=(data?.occurrences??[]).filter((o:any)=>o.recordTable==='organizationSeats');
 if(!observations.length)return null;
 const latestDate = observations.map((o:any)=>String(o.observedDate??'')).filter(Boolean).sort().at(-1);
 // P16: an imported workspace can have hundreds of roster observations and an
 // empty legal register. Say why, and offer to start a register entry from a
 // recent observation instead of leaving "0 directors" unexplained.
 const emptyRegisterNote = registerCount === 0 ? (
   <div className="card__body" role="status" style={{paddingBottom:0}}>
     <strong>The director register is empty, but {observations.length} roster observations were imported{latestDate ? ` (latest ${latestDate})` : ''}.</strong>{' '}
     Observations are evidence of who sat on the board or committees at a source date; they are not the current legal register, so they do not count toward the minimum number of directors.
     To build the register, add the current directors{onAddAsDirector && can('directors:write') ? ' (use "Add as director" on a recent board observation to prefill one)' : ''} and attach the AGM minutes or consent that appointed them.
   </div>
 ) : null;
 return <details className="card" style={{marginBottom:16}} open={registerCount === 0 || undefined}><summary className="card__head">Source board and committee observations ({observations.length})</summary>{emptyRegisterNote}<div className="card__body"><p>These source observations preserve people, organizations and roles at their recorded periods. Appointment dates, current status and legal membership require separate evidence.</p><Link to="/app/people-history">Review identities and dated history</Link><div style={{overflowX:'auto'}}><table className="table"><thead><tr><th>Source person</th><th>Role / committee</th><th>Affiliation at source date</th><th>Observed period</th><th>Identity review</th>{onAddAsDirector && can('directors:write') ? <th /> : null}</tr></thead><tbody>{observations.map((o:any)=><tr key={o._id}><td>{o.personId?<Link to={`/app/people-directory/${o.personId}`}>{o.personName}</Link>:o.personName||'Unknown'}</td><td>{sourceRoleLabel(o.roleTitle)} · {o.context}</td><td>{o.affiliation||'Unknown'}</td><td>{o.observedDate||'Unknown'}</td><td>{o.matchStatus} · <a href={o.sourceUrl} target="_blank" rel="noreferrer">{o.sourceReference}</a></td>{onAddAsDirector && can('directors:write') ? <td>{o.personName && isBoardSeatObservation(o) ? <button className="btn btn--ghost btn--sm" onClick={()=>onAddAsDirector(o)}>Add as director</button> : null}</td> : null}</tr>)}</tbody></table></div></div></details>;
}
