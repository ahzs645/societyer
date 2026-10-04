import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { toPortableQueryCtx } from "../convex/lib/portable";
import { overviewPortable } from "../shared/functions/library";
import { requireFunctionAction } from "../shared/functions/actionPolicy";
const issuer = betterAuthIssuer(), at = new Date().toISOString();
const test = convexTest(schema, {"./_generated/api.js":()=>import("../convex/_generated/api.js"),"./_generated/server.js":()=>import("../convex/_generated/server.js"),"./library.js":()=>import("../convex/library")} as any);
const fixture = await test.run(async ctx=>{
  const societyId = await ctx.db.insert("societies",{name:"Library projections",isCharity:false,isMemberFunded:false,updatedAt:0}), users:Record<string,any>={};
  for(const role of ["Owner","Admin","Director","Viewer","Member"]) users[role]=await ctx.db.insert("users",{societyId,role,status:"Active",displayName:role,email:`${role}@library.test`,authIssuer:issuer,authSubject:role,createdAtISO:at});
  const meetingId=await ctx.db.insert("meetings",{societyId,title:"Restricted meeting marker",type:"Board",scheduledAt:at,electronic:false,status:"Scheduled",attendeeIds:[],location:"Private meeting location"});
  const doc=await ctx.db.insert("documents",{societyId,title:"Readable library document",category:"Other",tags:["public"],flaggedForDeletion:false,createdAtISO:at});
  await ctx.db.insert("meetingMaterials",{societyId,meetingId,documentId:doc,order:0,requiredForMeeting:true,accessLevel:"public",accessGrants:[],availabilityStatus:"available",createdAtISO:at});
  return {societyId,users};
});
let original:any;
for(const role of ["Owner","Admin","Director","Viewer","Member"]){
  const result=await test.withIdentity({issuer,subject:role}).query(api.library.overview,{societyId:fixture.societyId});
  assert.equal(result.referenceDocuments.length,1);assert.equal(result.meetingPackets.length,1);assert.equal(result.meetingPackets[0].meeting.title,"Restricted meeting marker");assert.equal(result.counts.meetingMaterials,1);
  if(original) assert.deepEqual(result,original); else original=result;
}
await test.run(async ctx=>{
  const portable=await toPortableQueryCtx(ctx),args={societyId:String(fixture.societyId)};
  const scoped=(scopes:string[])=>({...portable,principal:{kind:"service" as const,runtime:"test" as const,assurance:"trusted-internal" as const,subject:"library-service",actorUserId:String(fixture.users.Owner),societyId:args.societyId,scopes}});
  const docsOnly=scoped(["documents:read"]);await requireFunctionAction(docsOnly,"library:overview","query",args);
  const projected=await overviewPortable(docsOnly,args);assert.equal(projected.referenceDocuments.length,1);assert.deepEqual(projected.meetingPackets,[]);assert.equal(projected.counts.meetingMaterials,0);assert.equal(projected.counts.meetingPackets,0);assert.ok(!JSON.stringify(projected).includes("Restricted meeting marker"));assert.ok(!JSON.stringify(projected).includes("Private meeting location"));
  assert.deepEqual(await overviewPortable(scoped(["documents:read","meetings:read"]),args),original);
  await assert.rejects(()=>requireFunctionAction(scoped(["meetings:read"]),"library:overview","query",args),/Service scope documents:read required/);
  await assert.rejects(()=>overviewPortable(scoped(["meetings:read"]),args),/Service scope documents:read required/);
});
console.log("Library resource authority passed: all five human role outputs unchanged; docs-only service retains authorized library documents while excluding meeting objects/material projections; combined scope restores original response.");
