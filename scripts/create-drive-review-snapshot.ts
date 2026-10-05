/** Create a new, isolated offline review workspace from source staging bundles.
 * This never contacts or changes a hosted organizational workspace.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { StaticConvexClient } from '../src/lib/staticConvex';
const dir=path.resolve(process.argv[2]??'work/source-audit/staging');
const target=path.resolve(process.argv[3]??'work/source-audit/offline-review-workspace.json');
const specialistDirectory=path.resolve(process.argv[4]??path.join(dir,'..'));
const source=new StaticConvexClient({databaseName:`drive-source-review-${Date.now()}`,seed:{societies:[]}});
const workspace=await source.mutation('society:createWorkspace',{name:'PGAIR source review',fiscalYearEnd:'12-31',jurisdictionCode:'CA-BC',entityType:'society',actFormedUnder:'bc_societies_act'});
const index=JSON.parse(fs.readFileSync(path.join(dir,'index.json'),'utf8'));
const files=index.bundles.map((x:any)=>path.join(dir,x.file));
for (const extra of ['financial-review-bundle.json','insurance-review-bundle.json']) {
  const file=path.join(specialistDirectory,extra);if(fs.existsSync(file))files.push(file);
}
let sessionCount=0,recordCount=0;
for (const file of files) {
  const bundle=JSON.parse(fs.readFileSync(file,'utf8'));
  bundle.metadata={...bundle.metadata,createdFrom:'Google Drive',reviewOnly:true,organizationOwnershipVerified:false,
    offlineStagingNote:'New isolated local review workspace. Ownership has not been confirmed for promotion into an official organization; all candidates remain Pending.'};
  const created=await source.mutation('importSessions:createFromBundle',{societyId:workspace.societyId,name:bundle.metadata.name||path.basename(file),bundle});
  const sessionId=typeof created==='string'?created:created.sessionId;
  const detail=await source.query('importSessions:get',{sessionId});
  assert.ok(detail.records.length>0);assert.ok(detail.records.every((x:any)=>x.status==='Pending'&&Object.keys(x.importedTargets??{}).length===0));
  sessionCount++;recordCount+=detail.records.length;
}
const snapshot=source.exportLocalWorkspaceSnapshot();
assert.equal(snapshot.tables.meetings?.length??0,0);assert.equal(snapshot.tables.journalEntries?.length??0,0);
assert.equal(snapshot.tables.memberHistoryEvents?.length??0,0);
fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(snapshot));
const restored=new StaticConvexClient({databaseName:`drive-source-review-restore-${Date.now()}`,seed:{societies:[]}});
await restored.importLocalWorkspaceSnapshot(snapshot);
const sessions=await restored.query('importSessions:list',{societyId:workspace.societyId});assert.equal(sessions.length,sessionCount);
fs.writeFileSync(target.replace(/\.json$/,'.validation.json'),JSON.stringify({isolatedOfflineWorkspace:true,sessionCount,recordCount,allPending:true,noPromotions:true,snapshotRoundTrip:true},null,2));
console.log(JSON.stringify({sessionCount,recordCount,allPending:true,snapshotRoundTrip:true}));
