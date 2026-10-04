import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { toPortableQueryCtx } from "../convex/lib/portable";
import { listRoleHoldersPortable } from "../shared/functions/roleHolders";
import { changesBetweenPortable, registerAsOfPortable, revisionHistoryPortable } from "../shared/functions/roleHolderHistory";
const issuer = betterAuthIssuer();
const test = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./legalOperations.js": () => import("../convex/legalOperations"),
  "./roleHolderHistory.js": () => import("../convex/roleHolderHistory"),
} as any);
const oldISO = "2025-01-01T00:00:00Z", newISO = "2026-01-01T00:00:00Z";
const fixture = await test.run(async ctx => {
  const societyId = await ctx.db.insert("societies", {name:"Legal registers",isCharity:false,isMemberFunded:false,updatedAt:0});
  const users: Record<string, any> = {};
  for(const role of ["Owner","Viewer","Member"]) users[role] = await ctx.db.insert("users",{societyId,role,status:"Active",displayName:role,email:`${role}@register.test`,authSubject:role,authIssuer:issuer,createdAtISO:newISO});
  const rows: Record<string, any> = {};
  for(const roleType of ["director","officer","controller","member","other"]){
    rows[roleType] = await ctx.db.insert("roleHolders",{societyId,roleType,status:"current",fullName:`${roleType} current`,email:`${roleType}@sensitive.test`,citizenshipCountries:[],taxResidenceCountries:[],relatedShareholderIds:[],controllingIndividualIds:[],sourceDocumentIds:[],sourceExternalIds:[],enteredAtISO:newISO,createdAtISO:oldISO,updatedAtISO:newISO});
    await ctx.db.insert("roleHolderRevisions",{societyId,roleHolderId:rows[roleType],dataJson:JSON.stringify({roleType,status:"current",fullName:`${roleType} prior`,email:`${roleType}@private.test`}),enteredAtISO:oldISO,supersededAtISO:newISO,createdAtISO:newISO});
  }
  // A now-readable representative must not expose its prior structured director identity.
  const changed = await ctx.db.insert("roleHolders",{societyId,roleType:"other",status:"current",fullName:"Readable representative",citizenshipCountries:[],taxResidenceCountries:[],relatedShareholderIds:[],controllingIndividualIds:[],sourceDocumentIds:[],sourceExternalIds:[],enteredAtISO:newISO,createdAtISO:oldISO,updatedAtISO:newISO});
  await ctx.db.insert("roleHolderRevisions",{societyId,roleHolderId:changed,dataJson:JSON.stringify({roleType:"director",status:"current",fullName:"Forbidden prior director",email:"forbidden@private.test"}),enteredAtISO:oldISO,supersededAtISO:newISO,createdAtISO:newISO});
  const deleted = await ctx.db.insert("roleHolders",{societyId,roleType:"officer",status:"current",fullName:"Deleted officer",citizenshipCountries:[],taxResidenceCountries:[],relatedShareholderIds:[],controllingIndividualIds:[],sourceDocumentIds:[],sourceExternalIds:[],createdAtISO:oldISO,updatedAtISO:oldISO});
  await ctx.db.insert("roleHolderRevisions",{societyId,roleHolderId:deleted,dataJson:JSON.stringify({roleType:"officer",fullName:"Deleted private officer",status:"current"}),enteredAtISO:oldISO,supersededAtISO:newISO,createdAtISO:newISO}); await ctx.db.delete(deleted);
  return {societyId,users,rows,changed,deleted};
});
const actors = Object.fromEntries(["Owner","Viewer","Member"].map(role => [role,test.withIdentity({subject:role,issuer})]));
const args = {societyId:fixture.societyId};
const list = await actors.Owner.query(api.legalOperations.listRoleHolders,args);
assert.equal(list.length,6); assert.deepEqual(await actors.Viewer.query(api.legalOperations.listRoleHolders,args),list);
const member = await actors.Member.query(api.legalOperations.listRoleHolders,args);
assert.deepEqual(member.map((row:any)=>row.roleType).sort(),["member","other","other"]);
assert.equal(member.find((row:any)=>row._id===fixture.changed)?.historyReadable,false);
assert.equal(member.find((row:any)=>row._id===fixture.rows.member)?.historyReadable,true);
assert.ok(list.every((row:any)=>row.historyReadable===true));
for(const roleType of ["director","officer","controller"]) await assert.rejects(()=>actors.Member.query(api.roleHolderHistory.revisionHistory,{roleHolderId:fixture.rows[roleType]}),/Permission (directors|settings):read required/);
await assert.rejects(()=>actors.Member.query(api.roleHolderHistory.revisionHistory,{roleHolderId:fixture.changed}),/Permission directors:read required/);
await assert.rejects(()=>actors.Member.query(api.roleHolderHistory.revisionHistory,{roleHolderId:fixture.deleted}),/Permission directors:read required/);
assert.equal((await actors.Owner.query(api.roleHolderHistory.revisionHistory,{roleHolderId:fixture.deleted})).length,1);
assert.equal((await actors.Viewer.query(api.roleHolderHistory.revisionHistory,{roleHolderId:fixture.changed})).length,2);
assert.equal((await actors.Member.query(api.roleHolderHistory.revisionHistory,{roleHolderId:fixture.rows.member})).length,2);
const historical = await actors.Member.query(api.roleHolderHistory.registerAsOf,{...args,asOfISO:"2025-06-01T00:00:00Z"}); assert.equal(historical.length,2); assert.ok(!JSON.stringify(historical).includes("Forbidden"));
const diff = await actors.Member.query(api.roleHolderHistory.changesBetween,{...args,fromISO:"2025-06-01T00:00:00Z",toISO:"2026-06-01T00:00:00Z"}); assert.equal(diff.length,2); assert.ok(diff.every((row:any)=>/member|other/.test(row.name)));
await test.run(async ctx => {
  const portable = await toPortableQueryCtx(ctx);
  const service = (scopes:string[])=>({...portable,principal:{kind:"service" as const,runtime:"test" as const,assurance:"trusted-internal" as const,subject:"register-service",actorUserId:String(fixture.users.Owner),societyId:String(fixture.societyId),scopes}});
  const docsOnly = service(["documents:read","members:read"]);
  assert.equal((await listRoleHoldersPortable(docsOnly,{societyId:String(fixture.societyId)})).length,3);
  assert.equal((await registerAsOfPortable(docsOnly,{societyId:String(fixture.societyId),asOfISO:"2025-06-01T00:00:00Z"})).length,2);
  assert.equal((await changesBetweenPortable(docsOnly,{societyId:String(fixture.societyId),fromISO:"2025-06-01T00:00:00Z",toISO:"2026-06-01T00:00:00Z"})).length,2);
  await assert.rejects(()=>revisionHistoryPortable(docsOnly,{roleHolderId:String(fixture.changed)}),/Service scope directors:read required/);
  const board = await listRoleHoldersPortable(service(["documents:read","directors:read"]),{societyId:String(fixture.societyId)}); assert.equal(board.length,5); assert.ok(!board.some(row=>row.roleType==="controller"));
});
console.log("Structured legal register authority passed: Owner/Viewer unchanged, Member permitted types, director/officer/controller current and historical isolation, transitioned/deleted revision protection, diff endpoint filtering and service scopes.");
