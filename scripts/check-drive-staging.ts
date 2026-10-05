import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { recordsFromBundle } from '../shared/functions/importSessionHelpers/importSessionRecordKinds';
import { inspectImportBundle } from '../src/lib/importBundleIntake';
import { sourceMeetingDateEvidence } from '../shared/driveStaging';
assert.equal(sourceMeetingDateEvidence('Board meeting minutes\nOctober 27th, 2021','Secretariat Oct27 2021.docx').date,'2021-10-27');
assert.equal(sourceMeetingDateEvidence('Board meeting minutes\nJanuary 18th, 2022','January18 2022.docx').date,'2022-01-18');
assert.equal(sourceMeetingDateEvidence('Annual General Meeting\nFinancial statements July 31, 2010','2010 AGM Script.doc').date,undefined);
assert.equal(sourceMeetingDateEvidence('Board minutes\nJanuary 16, 2024','Board minutes January16 2023.docx').date,undefined);
assert.equal(sourceMeetingDateEvidence('Board minutes\nJanuary 16, 2024','2023_01_16 Board minutes.docx').date,undefined);
assert.equal(sourceMeetingDateEvidence('Board minutes\nDate not recorded','2021 Board minutes.docx').date,undefined);
const root=fs.mkdtempSync(path.resolve('work/drive-staging-check-'));
try {
  const corpus=path.join(root,'corpus'),output=path.join(root,'staging');fs.mkdirSync(corpus);
  const textPath=path.join(corpus,'source.txt');
  fs.writeFileSync(textPath,'Prince George Air Improvement Roundtable\nBoard Meeting Minutes\nNovember 19, 2019\nPresent: Alice Example, Bob Example\nQuorum not reached\nMeeting adjourned at 6:00 p.m.\n');
  const source=(id:string,status='extracted')=>({id,name:status==='extracted'?'Board Meeting Minutes November 19 2019.docx':'Board Meeting Minutes December 2019.pdf',path:`Lexar/Board/${id}`,folder:false,metadataStub:false,url:`https://drive.google.com/file/d/${id}/view`,textStatus:status,downloadStatus:status==='extracted'?'downloaded':'failed',sha256:status==='extracted'?'same-actual-file-digest':undefined,textPath:status==='extracted'?textPath:undefined,error:status==='extracted'?undefined:'HTTP 503: remote connection failure'});
  const items=[source('source-a'),source('source-copy'),source('source-unread','failed')];
  fs.writeFileSync(path.join(corpus,'manifest.json'),JSON.stringify({rootId:'fixture',finished:true,items,folders:[]}));
  fs.writeFileSync(path.join(corpus,'extraction.json'),JSON.stringify({finished:true,items}));
  const run=spawnSync(process.execPath,['--import','tsx',path.resolve('scripts/stage-drive-audit.ts'),corpus,output],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const index=JSON.parse(fs.readFileSync(path.join(output,'index.json'),'utf8'));
  assert.equal(index.sourceCount,3);assert.equal(index.uniqueCandidates,2);
  const bundles=index.bundles.map((x:any)=>JSON.parse(fs.readFileSync(path.join(output,x.file),'utf8')));
  const sources=bundles.flatMap((x:any)=>x.sources);assert.equal(sources.length,3);
  assert.ok(sources.every((x:any)=>x.externalSystem==='google-drive' && x.url));
  assert.equal(sources.filter((x:any)=>x.extractedText).length,1,'Byte duplicates preserve both links but avoid duplicate transcript');
  assert.ok(sources.find((x:any)=>x.externalId==='google-drive:source-unread').notes.includes('Extraction incomplete'));
  const minutes=bundles.flatMap((x:any)=>x.meetingMinutes);assert.ok(minutes.length>=1);
  assert.ok(minutes.every((x:any)=>x.confidence==='Review' && x.status==='NeedsReview' && x.quorumStatus==='not_met'));
  assert.ok(minutes.every((x:any)=>x.sourceExternalIds.length===2));
  for (const bundle of bundles) {
    assert.equal(bundle.metadata.createdFrom,'Google Drive');
    const preview=inspectImportBundle(bundle,{_id:'fixture',name:'PRINCE GEORGE AIR IMPROVEMENT ROUNDTABLE SOCIETY'});
    assert.equal(preview.needsReview,true,'Mentioned organization remains a suggestion requiring destination review');
    assert.ok(recordsFromBundle(bundle).every((record:any)=>!record.status || record.status==='Pending'));
    assert.equal(bundle.transactionCandidates,undefined);assert.equal(bundle.members,undefined);
  }
  console.log('Drive staging passed: duplicate provenance, unread source ledger, destination review, no-quorum evidence, and no automatic postings.');
} finally {fs.rmSync(root,{recursive:true,force:true});}
