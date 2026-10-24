import {useConvex} from 'convex/react';
import {useEffect,useMemo,useState} from 'react';
import {api} from '@/lib/convexApi';
import {computeInvoiceTotals} from '../../../shared/invoicing';
import type {InvoiceWorkspace} from './types';

type Collections=Pick<InvoiceWorkspace,'templates'|'priceLists'|'repairJobs'>;
type CollectionSource={sourceTemplates:InvoiceWorkspace['templates'];sourcePriceLists:InvoiceWorkspace['priceLists'];sourceRepairs:InvoiceWorkspace['repairJobs'];refresh:number};
/** Subscribe to every bounded page, including records beyond the initial workspace ranges. */
export function useInvoiceCollections(workspace:InvoiceWorkspace|undefined,societyId:string|undefined){
  const client=useConvex();
  const [loaded,setLoaded]=useState<({societyId:string;data:Collections}&CollectionSource)|null>(null),[error,setError]=useState('');
  const [loading,setLoading]=useState(false),[refresh,setRefresh]=useState(0);
  const templates=workspace?.templates,priceLists=workspace?.priceLists,repairJobs=workspace?.repairJobs;
  useEffect(()=>{
    if(!societyId||!templates)return;
    let cancelled=false;const stops:Array<()=>void>=[];
    setLoading(true);setError('');
    const readPage=(collection:'templates'|'priceLists'|'repairs',cursor:string|null)=>new Promise<any>((resolve,reject)=>{
      const watch=client.watchQuery(api.invoicePreferences.collectionPage,{societyId,collection,cursor});
      let first=true,previous='';
      const changed=()=>{
        if(cancelled)return;
        try{
          const page=watch.localQueryResult();if(page===undefined)return;
          const serialized=JSON.stringify(page);
          if(first){first=false;previous=serialized;resolve(page);}
          else if(serialized!==previous){previous=serialized;setRefresh(value=>value+1);}
        }catch(problem){if(first){first=false;reject(problem);}else setError(problem instanceof Error?problem.message:'Could not refresh the complete invoice collections.');}
      };
      stops.push(watch.onUpdate(changed));changed();
    });
    async function load(collection:'templates'|'priceLists'|'repairs'){
      let cursor:string|null=null;const rows:any[]=[],seen=new Set<string>();
      do{const page=await readPage(collection,cursor);if(cancelled)return [];
        rows.push(...page.page);if(page.isDone)break;if(!page.continueCursor||seen.has(page.continueCursor))throw new Error('Invoice collection pagination did not advance.');seen.add(page.continueCursor);cursor=page.continueCursor;
      }while(true);
      return rows;
    }
    void Promise.all([load('templates'),load('priceLists'),load('repairs')]).then(([allTemplates,allLists,allRepairs])=>{
      if(!cancelled)setLoaded({societyId:societyId!,sourceTemplates:templates,sourcePriceLists:priceLists,sourceRepairs:repairJobs,refresh,data:{templates:allTemplates,priceLists:allLists,repairJobs:allRepairs as any}});
    }).catch(problem=>{if(!cancelled)setError(problem instanceof Error?problem.message:'Could not load the complete invoice collections.');}).finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;for(const stop of stops)stop();};
  },[client,societyId,templates,priceLists,repairJobs,refresh]);
  const complete=useMemo(()=>{
    if(!workspace||!loaded||loaded.societyId!==societyId)return workspace;
    return {...workspace,...loaded.data,repairJobs:(loaded.data.repairJobs??[]).map(job=>({...job,totalCents:computeInvoiceTotals(job.lines??[]).totalCents,invoice:workspace.invoices.find(invoice=>invoice.repairJobId===job._id&&invoice.lifecycle!=='void')??null}))};
  },[workspace,loaded,societyId]);
  const ready=Boolean(loaded&&loaded.societyId===societyId&&loaded.refresh===refresh&&loaded.sourceTemplates===templates&&loaded.sourcePriceLists===priceLists&&loaded.sourceRepairs===repairJobs);
  return {workspace:complete,ready,loading,error,retry:()=>setRefresh(value=>value+1)};
}
