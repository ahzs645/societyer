import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createPersistentOperator } from "./procurement/operator-client";

const deployment = "explicit-test-123", url = `https://${deployment}.convex.cloud`;
const credentials = {deploymentName:deployment,deploymentType:"prod",url,adminKey:"private-admin-test-key"};
const readText = (path: string) => path.endsWith("/.convex/config.json") ? JSON.stringify({accessToken:"private-cli-test-token"}) : undefined;
let authorizationCalls=0, functionCalls=0;
const transport: typeof fetch = async (resource, init) => {
  assert.equal(init?.redirect,"error","Credentials must never follow redirects");
  assert.ok(init?.signal,"Requests have a bounded deadline");
  if (String(resource).startsWith("https://api.convex.dev/")) {
    authorizationCalls++;
    assert.equal(new Headers(init?.headers).get("Authorization"),"Bearer private-cli-test-token");
    assert.deepEqual(JSON.parse(String(init?.body)),{selectedDeploymentName:deployment,projectSelection:{kind:"deploymentName",deploymentName:deployment,deploymentType:null}});
    return Response.json(credentials);
  }
  functionCalls++;
  assert.equal(String(resource),url+"/api/function");
  assert.equal(new Headers(init?.headers).get("Authorization"),"Convex private-admin-test-key");
  return Response.json({status:"success",value:JSON.parse(String(init?.body)).args});
};
const options={environment:{},readText,fetch:transport};
const operator=await createPersistentOperator(deployment,options);
const operations=[{type:"upsert",row:JSON.stringify({value:1.5,title:"😀 and \\ literal"}),before:null}];
for (let i=0;i<3;i++) assert.deepEqual(await operator.run("procurementSync:applyBatch",JSON.stringify({batch:i,operations})),{batch:i,operations});
assert.equal(authorizationCalls,1,"All calls reuse one CLI authorization in memory");
assert.equal(functionCalls,3);
await assert.rejects(operator.run("unrelated:write","{}"),/allowlist/);
operator.close();
for (const name of ["CONVEX_DEPLOY_KEY","CONVEX_DEPLOYMENT_TOKEN","CONVEX_OVERRIDE_ACCESS_TOKEN","CONVEX_PROVISION_HOST","CONVEX_SELF_HOSTED_URL","CONVEX_SELF_HOSTED_ADMIN_KEY"]) {
  await assert.rejects(createPersistentOperator(deployment,{...options,environment:{[name]:"private"}}),/refuses alternate/);
  for(const file of [".env",".env.local"]) for(const prefix of ["","   ","  export   "]) {
    await assert.rejects(createPersistentOperator(deployment,{...options,readText:path=>path.endsWith("/"+file)?prefix+name+" = private\n":readText(path)}),/refuses alternate/);
  }
}
assert.equal(authorizationCalls,1,"Unsupported auth is rejected before any network request");
for(const mismatch of [{deploymentName:"other-123"},{deploymentType:"dev"},{url:"https://unexpected.example"},{adminKey:""}]) {
  await assert.rejects(createPersistentOperator(deployment,{...options,fetch:async()=>Response.json({...credentials,...mismatch})}),/unexpected production deployment/);
}
await assert.rejects(createPersistentOperator("prod",options),/explicit cloud deployment/);
await assert.rejects(createPersistentOperator(deployment,{...options,fetch:async()=>new Response("private-secret-that-must-not-escape",{status:403})}),error=>String(error).includes("HTTP 403")&&!String(error).includes("private-secret"));
let failures=0;
const failed=await createPersistentOperator(deployment,{...options,fetch:async(resource,init)=>String(resource).startsWith("https://api.convex.dev/")?transport(resource,init):(failures++,Promise.reject(new Error("network failed")))});
await assert.rejects(failed.run("procurementSync:applyBatch","{}"),/network failed/);
assert.equal(failures,1,"Mutations are not automatically retried");

// Mock file existence as well as reads; this test must not depend on a real CLI login.
const mockedLoginExists="const originalExists=fs.existsSync;fs.existsSync=function(path){return String(path).endsWith('/.convex/config.json')||originalExists.call(this,path)};";
const directory=mkdtempSync(join(tmpdir(),"procurement-operator-"));
try {
  const python=`import pathlib,sys,importlib.util\nsys.path.insert(0,sys.argv[1])\nspec=importlib.util.spec_from_file_location('fixtures',pathlib.Path(sys.argv[1])/'test-integrity.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nfrom delta import plan_delta\nr=pathlib.Path(sys.argv[2]);keys=tuple('award:'+str(i) for i in range(85));m.fixture(r/'baseline',keys);m.fixture(r/'target',keys,title='Corrected');plan_delta(r/'baseline',r/'target')`;
  const built=spawnSync("python3",["-c",python,resolve("scripts/procurement"),directory],{encoding:"utf8"});
  assert.equal(built.status,0,built.stderr);
  const target=join(directory,"target"),baseline=join(directory,"baseline"),marker=join(directory,"network-or-credential-read"),guard=join(directory,"guard.cjs");
  writeFileSync(guard,`const fs=require('node:fs'),original=fs.readFileSync;${mockedLoginExists}fs.readFileSync=function(path,...args){if(String(path).endsWith('/.convex/config.json')){fs.writeFileSync(${JSON.stringify(marker)},'credential');throw Error('credential read');}return original.call(this,path,...args)};require('node:module').syncBuiltinESMExports();global.fetch=async()=>{fs.writeFileSync(${JSON.stringify(marker)},'network');throw Error('network call')};`);
  const common=["--require",guard,"--import","tsx","scripts/procurement/apply-convex.ts","--deployment",deployment,"--input",target,"--baseline",baseline,"--persistent-operator"];
  const dryRun=spawnSync(process.execPath,[...common,"--dry-run"],{encoding:"utf8"});
  assert.equal(dryRun.status,0,dryRun.stderr);assert.equal(existsSync(marker),false,"Dry-run never reads credentials or makes network requests");
  const details=join(target,"procurementDetails.jsonl"),originalDetails=readFileSync(details);writeFileSync(details,"corrupt\n");
  const invalid=spawnSync(process.execPath,common,{encoding:"utf8"});
  assert.notEqual(invalid.status,0);assert.equal(existsSync(marker),false,"Corrupt input is rejected before credentials or network");writeFileSync(details,originalDetails);
  const mock=join(directory,"mock.cjs"),trace=join(directory,"trace.json"),activation=JSON.parse(readFileSync(join(target,"activation.json"),"utf8"));
  writeFileSync(mock,`const fs=require('node:fs'),original=fs.readFileSync,activation=${JSON.stringify(activation)},trace=[];let applied=40,finished=false,inFlight=false;${mockedLoginExists}fs.readFileSync=function(path,...args){if(String(path).endsWith('/.convex/config.json'))return JSON.stringify({accessToken:'private-cli-test-token'});return original.call(this,path,...args)};require('node:module').syncBuiltinESMExports();global.fetch=async(resource,init)=>{if(String(resource).startsWith('https://api.convex.dev/'))return Response.json(${JSON.stringify(credentials)});if(inFlight)throw Error('Concurrent operator request');inFlight=true;await new Promise(resolve=>setTimeout(resolve,2));const body=JSON.parse(init.body);trace.push(body);let value=null;if(body.path==='procurementImport:state')value={...activation,...(finished?{activatedAt:1}:{generation:'baseline',contentHash:'baseline'}),updating:!finished};else if(body.path==='procurementImport:beginJob')value='job';else if(body.path==='procurementSync:begin')value={runId:'run',applied,nextBatch:1,completed:false};else if(body.path==='procurementSync:applyBatch'){applied+=body.args.operations.length;value={applied,nextBatch:body.args.batch+1}}else if(body.path==='procurementSync:finish')finished=true;else if(body.path==='procurementImport:beginTaxonomy')value='reuse';inFlight=false;fs.writeFileSync(${JSON.stringify(trace)},JSON.stringify(trace));return Response.json({status:'success',value});};`);
  const liveMock=spawnSync(process.execPath,["--require",mock,"--import","tsx","scripts/procurement/apply-convex.ts","--deployment",deployment,"--input",target,"--baseline",baseline,"--persistent-operator"],{encoding:"utf8"});
  assert.equal(liveMock.status,0,liveMock.stderr);
  const requests=JSON.parse(readFileSync(trace,"utf8")),batches=requests.filter((request:any)=>request.path==="procurementSync:applyBatch");
  const lines=readFileSync(join(target,"delta.jsonl"),"utf8").trim().split("\n").map(line=>JSON.parse(line));
  assert.equal(lines.length,85);
  assert.deepEqual(batches.map((request:any)=>[request.args.batch,request.args.operations.length]),[[1,40],[2,5]],"Resume skips the exact committed 40-row batch");
  const expected=lines.slice(40).map(raw=>({...raw,row:raw.row===null?null:JSON.stringify(raw.row),before:raw.before===null?null:JSON.stringify(raw.before)}));
  assert.deepEqual(batches.flatMap((request:any)=>request.args.operations),expected,"Operation JSON strings, before images and ordering remain identical");
  for(let i=0;i<batches.length;i++) assert.equal(createHash("sha256").update(JSON.stringify(batches[i].args.operations)).digest("hex"),createHash("sha256").update(JSON.stringify(expected.slice(i*40,i*40+40))).digest("hex"),"Committed batch digests remain identical");
  assert.equal(JSON.parse(readFileSync(join(target,"serving-receipt.json"),"utf8")).state,"ready");
  assert.equal(requests.at(-1).path,"procurementImport:state","Activation outcome is reconciled before the ready receipt");
  console.log("OK: persistent CLI-session auth, strict deployment/host/env checks, bounded no-redirect requests, no unsafe retries, local-only preflight/dry-run, sequential exact 40-row replay and unchanged batch digests/receipts.");
} finally {rmSync(directory,{recursive:true,force:true});}
