import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import { mkdtempSync,writeFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import schema from "../convex/schema";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { defaultIntegrationSettings } from "../shared/integrationSettings";

for(const key of ["TENANT_ID","CLIENT_ID","CLIENT_SECRET","SITE_ID","DRIVE_ID","TRANSFER_HOSTS"])process.env[`PROCUREMENT_SHAREPOINT_${key}`]="synthetic";
const t=convexTest(schema,{
  "./_generated/api.js":()=>import("../convex/_generated/api.js"),
  "./_generated/server.js":()=>import("../convex/_generated/server.js"),
  "./procurementStatus.js":()=>import("../convex/procurementStatus"),
  "./procurementReview.js":()=>import("../convex/procurementReview"),
}as any),api:any=anyApi;
const issuer=betterAuthIssuer(),now=Date.now(),publishedAt=new Date(now-10000).toISOString();
const fixture=await t.run(async ctx=>{
  const societyId=await ctx.db.insert("societies",{name:"Source receipt fixture",isCharity:false,isMemberFunded:false,disabledModules:["+procurementReview"],updatedAt:0});
  const folder=`Zoer/bc-bid-monitor/${societyId}`;
  await ctx.db.patch(societyId,{integrationSettings:{...defaultIntegrationSettings(),procurementReviewFolder:folder}});
  await ctx.db.insert("users",{societyId,email:"source-reader@example.invalid",displayName:"Reader",role:"Viewer",status:"Active",authSubject:"reader",authIssuer:issuer,authProvider:"better-auth",createdAtISO:"2026-10-22"});
  const catalogId=await ctx.db.insert("procurementCatalogs",{societyId,folder,generation:"old-reader-v2",publicationId:"old",sourceSnapshotId:"old-source",publishedAt:new Date(now-86400000).toISOString(),counts:{award:1}});
  return{societyId,folder,catalogId};
});
const reader=t.withIdentity({subject:"reader",issuer}),scope={societyId:fixture.societyId};
const announcement={schemaVersion:1,societyId:fixture.societyId,folder:fixture.folder,publicationId:"new-source",sourceSnapshotId:"new-snapshot",publishedAt,complete:false,coverage:{complete:false,sources:[]},state:"published",phase:"exporting",heartbeatAt:new Date(now-9000).toISOString()};
const before=await t.run(ctx=>ctx.db.get(fixture.catalogId));
assert.deepEqual(await t.mutation(api.procurementStatus.reportSource,announcement),{accepted:true,state:"published"});
assert.deepEqual(await t.mutation(api.procurementStatus.reportSource,announcement),{accepted:false,state:"published"},"Exact announcement replay is idempotent");
let status=await reader.query(api.procurementStatus.get,scope);
assert.equal(status.state,"available");assert.equal(status.source.generation,"new-source-reader-v2");assert.equal(status.lastSuccessful.generation,"old-reader-v2");
assert.equal((await reader.query(api.procurementReview.catalog,scope)).generation,"old-reader-v2");
await t.mutation(api.procurementStatus.reportSource,{...announcement,state:"failed",phase:"preflight",error:"Required detail export is missing",heartbeatAt:new Date(now-8000).toISOString()});
status=await reader.query(api.procurementStatus.get,scope);
assert.equal(status.state,"failed");assert.equal(status.source.phase,"preflight");assert.match(status.source.error,/detail export is missing/);assert.equal(status.run,null);
assert.deepEqual(await t.run(ctx=>ctx.db.get(fixture.catalogId)),before,"Source announcement/failure never locks or modifies serving data");
await t.mutation(api.procurementStatus.reportSource,{...announcement,publicationId:"older-source",sourceSnapshotId:"older-snapshot",publishedAt:new Date(now-86400000).toISOString(),heartbeatAt:new Date(now-7000).toISOString()});
assert.equal((await reader.query(api.procurementStatus.get,scope)).source.generation,"new-source-reader-v2","An old publisher heartbeat cannot regress the latest source pointer");
await assert.rejects(t.mutation(api.procurementStatus.reportSource,{...announcement,sourceSnapshotId:"changed-source"}),/immutable metadata changed/);
await assert.rejects(t.mutation(api.procurementStatus.reportSource,{...announcement,folder:`Zoer/bc-bid-monitor/foreign`}),/workspace|folder/i);
await assert.rejects(t.mutation(api.procurementStatus.reportSource,{...announcement,state:"ready",heartbeatAt:new Date(now-6000).toISOString()}),/before its catalog is serving/);
await assert.rejects(t.mutation(api.procurementStatus.reportSource,{...announcement,heartbeatAt:new Date(Date.now()+600000).toISOString()}),/Invalid source-publication receipt/);
assert.equal((await t.mutation(api.procurementStatus.reportSource,announcement)).accepted,false,"A stale receipt cannot erase a newer failure");
await t.mutation(api.procurementStatus.reportSource,{...announcement,heartbeatAt:new Date(now-5000).toISOString()});
assert.equal((await reader.query(api.procurementStatus.get,scope)).state,"available","An exact retry can restart failed export preparation");
await t.run(ctx=>ctx.db.patch(fixture.catalogId,{generation:"new-source-reader-v2",publicationId:"new-source",sourceSnapshotId:"new-snapshot",publishedAt,activatedAt:now}));
await t.mutation(api.procurementStatus.reportSource,{...announcement,state:"ready",phase:"ready",heartbeatAt:new Date(now-4000).toISOString()});
assert.equal((await t.mutation(api.procurementStatus.reportSource,{...announcement,state:"failed",error:"Late receipt upload error",heartbeatAt:new Date(now-3000).toISOString()})).state,"ready","Late reporting errors cannot downgrade an already serving publication");
status=await reader.query(api.procurementStatus.get,scope);
assert.equal(status.state,"ready");assert.equal(status.source.error,null);assert.equal(status.source.phase,"ready");
await assert.rejects(t.query(api.procurementStatus.get,scope),/auth|identity|sign|access/i);
await assert.rejects(t.withIdentity({subject:"foreign",issuer}).query(api.procurementStatus.get,scope),/auth|identity|sign|access|membership|workspace|bound/i);

const directory=mkdtempSync(join(tmpdir(),"source-receipt-"));
try{
  const input=join(directory,"source.json");writeFileSync(input,JSON.stringify(announcement));
  const args=["--import","tsx","scripts/procurement/report-source-publication.ts","--deployment","does-not-exist","--input",input,"--dry-run"];
  const dryRun=spawnSync(process.execPath,args,{encoding:"utf8"});assert.equal(dryRun.status,0,dryRun.stderr);assert.match(dryRun.stdout,/no network request or serving-data mutation/);
  writeFileSync(input,JSON.stringify({...announcement,complete:true}));
  const invalid=spawnSync(process.execPath,args,{encoding:"utf8"});assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/Invalid source-publication coverage/);
}finally{rmSync(directory,{recursive:true,force:true});}
console.log("OK: independent source-publication visibility, preflight failure with previous catalog readable, tenant/folder gates, immutable receipt identity, monotonic replay, concurrent-old-publisher safety, serving-verified terminal state, and local reporting dry-run.");
