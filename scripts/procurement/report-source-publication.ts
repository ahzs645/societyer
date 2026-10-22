/** Publisher-only source receipt reporting. Does not import, lock, or activate catalog rows. */
import { lstatSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { validateWorkspaceProcurementReviewFolder } from "../../shared/procurementReview/paths";

const args=process.argv.slice(2);
const value=(flag:string)=>{const index=args.indexOf(flag);return index<0?undefined:args[index+1];};
const deployment=value("--deployment"),input=value("--input");
if(!deployment||!input)throw new Error("Usage: tsx scripts/procurement/report-source-publication.ts --deployment NAME --input PRIVATE_SOURCE_RECEIPT_JSON [--dry-run]");
const path=resolve(input),stat=lstatSync(path);
if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64000)throw new Error("Source receipt must be a regular JSON file under 64KB.");
const receipt=JSON.parse(readFileSync(path,"utf8"));
const allowed=new Set(["schemaVersion","societyId","folder","publicationId","sourceSnapshotId","generation","publishedAt","collectedAt","complete","coverage","state","phase","error","heartbeatAt"]);
if(!receipt||typeof receipt!=="object"||Array.isArray(receipt)||Object.keys(receipt).some(key=>!allowed.has(key))||receipt.schemaVersion!==1||typeof receipt.complete!=="boolean"||!["published","failed","ready"].includes(receipt.state)||!["societyId","folder","publicationId","sourceSnapshotId","publishedAt","phase","heartbeatAt"].every(key=>typeof receipt[key]==="string"&&receipt[key].length>0&&receipt[key].length<=500))throw new Error("Invalid source-publication receipt.");
validateWorkspaceProcurementReviewFolder(receipt.societyId,receipt.folder);
for(const key of ["publishedAt","heartbeatAt","collectedAt"])if(receipt[key]!==undefined&&(!Number.isFinite(Date.parse(receipt[key]))||Date.parse(receipt[key])>Date.now()+300000))throw new Error("Invalid source-publication timestamp.");
if(receipt.generation!==undefined&&(typeof receipt.generation!=="string"||!receipt.generation||receipt.generation.length>256)||receipt.error!==undefined&&typeof receipt.error!=="string")throw new Error("Invalid source-publication detail.");
if(receipt.coverage!==undefined){
  const coverage=receipt.coverage;
  if(!coverage||typeof coverage.complete!=="boolean"||!Array.isArray(coverage.sources)||coverage.sources.some((source:any)=>!source||typeof source.source!=="string"||typeof source.complete!=="boolean")||receipt.complete!==(coverage.complete&&coverage.sources.every((source:any)=>source.complete)))throw new Error("Invalid source-publication coverage.");
}
if(args.includes("--dry-run")){
  console.log(JSON.stringify({publicationId:receipt.publicationId,state:receipt.state,action:"Validated source receipt locally; no network request or serving-data mutation."}));
}else{
  const require=createRequire(import.meta.url),pkgPath=require.resolve("convex/package.json"),cliPath=join(dirname(pkgPath),JSON.parse(readFileSync(pkgPath,"utf8")).bin.convex);
  const runner='const fs=require("node:fs");const a=JSON.parse(fs.readFileSync(0,"utf8"));process.argv=[process.execPath,a[0],...a.slice(1)];require(a[0]);';
  const result=spawnSync(process.execPath,["-e",runner],{input:JSON.stringify([cliPath,"run","procurementStatus:reportSource",JSON.stringify(receipt),"--deployment",deployment]),encoding:"utf8",stdio:["pipe","inherit","inherit"]});
  if(result.status!==0)throw new Error("Source-publication receipt reporting failed; the local receipt remains available for an exact retry.");
}
