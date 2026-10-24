import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { validateExport, validateDelta } from "./procurement/verify-export";

const directory = mkdtempSync(join(tmpdir(), "societyer-publication-"));
try {
  const python = `import sys,pathlib\nsys.path.insert(0,sys.argv[1])\nfrom test_integrity_fixture import fixture\nfrom delta import plan_delta\nroot=pathlib.Path(sys.argv[2]);fixture(root/'baseline',('award:1','award:2'));fixture(root/'target',title='Corrected award');plan_delta(root/'baseline',root/'target')`;
  // Reuse the real exporter fixture without requiring a renamed Python module.
  const script = python.replace("from test_integrity_fixture import fixture", "import importlib.util\nspec=importlib.util.spec_from_file_location('fixtures',pathlib.Path(sys.argv[1])/'test-integrity.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);fixture=module.fixture") + `
import json,zipfile
catalog=json.loads((root/'target'/'activation.json').read_text());catalog['storageGeneration']='physical';catalog['searchReady']=True
with zipfile.ZipFile(root/'backup.zip','w') as archive:
 archive.writestr('procurementCatalogs/documents.jsonl',json.dumps(catalog)+'\\n')
 for table in ('procurementRecords','procurementDetails','procurementDocuments','procurementEvidence'):
  rows=[dict(json.loads(line),generation='physical') for line in (root/'target'/(table+'.jsonl')).read_text().splitlines()]
  archive.writestr(table+'/documents.jsonl',''.join(json.dumps(row)+'\\n' for row in rows))
spec=importlib.util.spec_from_file_location('restore',pathlib.Path(sys.argv[1])/'restore-export.py');restore=importlib.util.module_from_spec(spec);spec.loader.exec_module(restore);restore.prepare(root/'backup.zip','workspace',root/'restored');restore.prepare(root/'backup.zip','workspace',root/'restored-fresh','restore-fresh-20261022')
fixture(root/'unicode-baseline',('award:\\U0001f600','award:\\ue000'));fixture(root/'unicode-target',('award:\\U0001f600',),title='Changed');plan_delta(root/'unicode-baseline',root/'unicode-target')
`;
  const built = spawnSync("python3", ["-c", script, resolve("scripts/procurement"), directory], {encoding:"utf8"});
  assert.equal(built.status,0,built.stderr);
  const targetDirectory=join(directory,"target"),baselineDirectory=join(directory,"baseline");
  const target=await validateExport(targetDirectory);
  const unicodeTarget=await validateExport(join(directory,"unicode-target"));
  assert.equal((await validateDelta(join(directory,"unicode-target"),join(directory,"unicode-baseline"),unicodeTarget)).delta.operations,3,"Cross-language deltas sort keys by Unicode code points");
  const verified=await validateDelta(targetDirectory,baselineDirectory,target);
  assert.equal(verified.delta.operations,3,"One corrected record and both rows of a verified removal");
  assert.equal(target.activation.tables.procurementDocuments.rowCount,0,"Explicit empty files are valid");
  const dryRun=spawnSync(process.execPath,["--import","tsx","scripts/procurement/apply-convex.ts","--deployment","does-not-exist","--input",targetDirectory,"--baseline",baselineDirectory,"--dry-run"],{encoding:"utf8"});
  assert.equal(dryRun.status,0,dryRun.stderr);
  assert.match(dryRun.stdout,/no network requests or serving mutations/);
  const missingBaseline=spawnSync(process.execPath,["--import","tsx","scripts/procurement/apply-convex.ts","--deployment","does-not-exist","--input",targetDirectory,"--dry-run"],{encoding:"utf8"});
  assert.notEqual(missingBaseline.status,0);assert.match(missingBaseline.stderr,/requires --baseline/);
  const restoredDirectory=join(directory,"restored"),backup=join(directory,"backup.zip");
  const restored=await validateExport(restoredDirectory);
  assert.equal(restored.rows.procurementRecords[0].generation,restored.activation.generation,"Restore projects the backup physical generation into its logical publication");
  const fresh=await validateExport(join(directory,"restored-fresh"));
  assert.equal(fresh.activation.generation,"restore-fresh-20261022");
  assert.equal(fresh.activation.restoration.sourceGeneration,restored.activation.generation,"Fresh rollback retains the original source generation");
  assert.equal(fresh.activation.contentHash,restored.activation.contentHash,"A fresh serving generation preserves the original content identity");
  assert.equal(fresh.activation.sourceCatalogSha256,restored.activation.sourceCatalogSha256);
  assert.notEqual(fresh.activation.inventoryHash,restored.activation.inventoryHash,"Remapped generation is sealed in a new exact inventory");
  for(const table of ["procurementRecords","procurementDetails","procurementDocuments","procurementEvidence"]) assert.ok(fresh.rows[table].every(row=>row.generation===fresh.activation.generation));
  const restoreArgs=["--import","tsx","scripts/procurement/apply-convex.ts","--deployment","does-not-exist","--input",restoredDirectory,"--dry-run"];
  const missingRestoreIntent=spawnSync(process.execPath,restoreArgs,{encoding:"utf8"});
  assert.notEqual(missingRestoreIntent.status,0);assert.match(missingRestoreIntent.stderr,/requires --restore-backup/);
  const restoredDryRun=spawnSync(process.execPath,[...restoreArgs,"--restore-backup",backup],{encoding:"utf8"});
  assert.equal(restoredDryRun.status,0,restoredDryRun.stderr);
  const details=join(targetDirectory,"procurementDetails.jsonl"),original=readFileSync(details);
  unlinkSync(details);
  await assert.rejects(validateExport(targetDirectory),/ENOENT/);
  writeFileSync(details,original);
  const manifestPath=join(targetDirectory,"delta-manifest.json"),delta=JSON.parse(readFileSync(manifestPath,"utf8"));
  writeFileSync(join(targetDirectory,"delta.jsonl"),"");
  delta.operations=0;delta.sha256=createHash("sha256").update("").digest("hex");
  writeFileSync(manifestPath,JSON.stringify(delta));
  await assert.rejects(validateDelta(targetDirectory,baselineDirectory,target),/differs from verified baseline\/target/,
    "A well-hashed delta may not omit required operations");
  writeFileSync(details,Buffer.concat([original,Buffer.from("{}\n")]));
  await assert.rejects(validateExport(targetDirectory),/Table integrity mismatch/);
  console.log("OK: independent TS publication validation, explicit emptiness, missing/corrupt files, exact delta binding, omitted-operation rejection, baseline requirement, and fully local operator dry-run.");
} finally {
  rmSync(directory,{recursive:true,force:true});
}
