/** Build review-only, source-linked import bundles from a completed Drive corpus.
 * Usage: npx tsx scripts/stage-drive-audit.ts <source-audit-dir> <output-dir>
 * No network access, database writes, inferred memberships or ledger postings.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isLikelyMeetingMinutesDocument, meetingMinutesFromPaperlessDocument, splitMeetingSections } from '../convex/paperlessHelpers';
import { sourceMeetingDateEvidence } from '../shared/driveStaging';
import { recordsFromBundle } from '../shared/functions/importSessionHelpers/importSessionRecordKinds';
import { quorumStatementFromText } from '../shared/quorumStatement';
import { dedupeKeyForDriveItem } from '../shared/driveDedupe';

const corpus = path.resolve(process.argv[2] ?? '/workspace/work/source-audit');
const destination = path.resolve(process.argv[3] ?? 'work/source-audit/staging');
fs.mkdirSync(destination, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(corpus, 'manifest.json'), 'utf8'));
const extraction = JSON.parse(fs.readFileSync(path.join(corpus, 'extraction.json'), 'utf8'));
if (!manifest.finished || !extraction.finished) throw new Error('Wait for completed inventory and extraction before building final bundles.');
const items = extraction.items as any[];
const shaGroups = new Map<string, any[]>();
for (const item of items) {
  // ID-03: empty or failed downloads share the empty-content SHA-256; they are
  // not duplicates of each other, so they keep their own identity.
  const key = dedupeKeyForDriveItem(item);
  shaGroups.set(key, [...(shaGroups.get(key) ?? []), item]);
}
const index: any[] = [];
const meetingAudit: any[] = [];
let sourceCount = 0, minutesCount = 0;
const buckets = new Map<string, any[]>();
const primary = 'PRINCE GEORGE AIR IMPROVEMENT ROUNDTABLE SOCIETY';
const candidates: any[] = [];
function modules(item: any, text: string): string[] {
  const signal = `${item.path} ${text.slice(0, 2000)}`;
  const found: string[] = [];
  if (/minut|agenda|board|committee|meeting/i.test(signal)) found.push('meetings');
  if (/financ|income statement|balance sheet|budget|invoice|bank|treasur/i.test(signal)) found.push('financials');
  if (/insur|endorsement|policy number|certificate of (?:liability|coverage)/i.test(signal)) found.push('insurance');
  if (/director|prox(?:y|ies)|member|roster|consent to act/i.test(signal)) found.push('directors');
  if (/bylaw|policy|terms of reference|constitution/i.test(signal)) found.push('policies');
  return found.length ? found : ['archiveAccessions'];
}
for (const aliases of shaGroups.values()) {
  const item = aliases.find(x => x.textStatus === 'extracted') ?? aliases[0];
  const raw = item.textPath && fs.existsSync(item.textPath) ? fs.readFileSync(item.textPath, 'utf8') : '';
  const owner = /\bP\.?G\.?\s?AIR\b|Prince George Air Improvement Roundtable/i.test(raw.slice(0, 7000)) ? primary : '';
  const externalId = `google-drive:${item.id}`;
  const sections = modules(item, raw);
  const flags = [
    'Needs review: machine extraction does not establish source accuracy, approval, ownership, or financial posting eligibility.',
    ...(aliases.length > 1 ? [`Exact byte duplicates: ${aliases.length} sources retained in provenance; one candidate generated.`] : []),
    ...(item.textStatus !== 'extracted' ? [`Extraction incomplete: ${item.textStatus}; ${item.error ?? 'OCR or original review required'}.`] : []),
    ...(!owner ? ['Ownership not established from document header; review destination before importing.'] : []),
    ...(raw.length > 180000 ? ['Extracted text exceeds per-record staging limit; full transcript remains in corpus.'] : []),
  ];
  const isMeetingTitle = /minut|mtg|meeting/i.test(item.name);
  const doc = { id: item.id, title: item.name, original_file_name: item.name, content: raw };
  const isMinutes = raw.trim().length >= 50 && isLikelyMeetingMinutesDocument(doc);
  // Folder-derived discovery tags do not establish a document's category.
  const categorySignal = `${item.name} ${raw.slice(0,300)}`;
  const isInvoice = /invoice|receipt|statement of account/i.test(item.name);
  const category = isInvoice ? 'Other'
    : /bylaw/i.test(item.name) ? 'Bylaws'
    : /constitution/i.test(item.name) ? 'Constitution'
    : /balance sheet|income statement|financial statements?|comparative (?:income|balance)/i.test(categorySignal) ? 'FinancialStatement'
    : isMinutes || /\bminutes\b/i.test(item.name) ? 'Minutes'
    : /policy|insurance|endorsement|certificate of liability/i.test(item.name) ? 'Policy'
    : /agreement|\bMOU\b|contract|letter of understanding/i.test(item.name) ? 'Agreement' : 'Other';
  const mayContainMinutes = isMinutes || isMeetingTitle || (/\bminutes\b/i.test(raw) && /\b(?:quorum|moved|seconded|motion|call(?:ed)? to order)\b/i.test(raw));
  if (!sections.some(x => ['meetings','financials','insurance','directors','policies'].includes(x)) && !mayContainMinutes) continue;
  const extractedText = raw.slice(0, 180000);
  const groupSources = aliases.map(alias => ({
    externalSystem: 'google-drive', externalId: `google-drive:${alias.id}`, title: alias.name,category,
    url: alias.url, fileName: alias.name, fileSizeBytes: alias.bytes, sha256: alias.sha256,
    confidence: 'Review', sensitivity: sections.some(x => ['financials','insurance','directors'].includes(x)) ? 'restricted' : 'standard',
    tags: ['drive-source-audit',...sections], notes: [...flags,`Original folder path: ${alias.path}`].join('\n'),
    // The canonical source preserves full staged text; duplicates retain provenance only.
    ...(alias.id === item.id && extractedText ? { extractedText, extractionMethod: item.extractionMethod ?? 'document-text-extraction' } : {}),
  }));
  const isTemplateOrScript = /\b(script|template|blank)\b/i.test(item.name);
  const parsedMinutes = isMinutes && !isTemplateOrScript ? meetingMinutesFromPaperlessDocument(doc) : [];
  const parsedSections = isMinutes ? splitMeetingSections(doc) : [];
  const dateReview: any[] = [];
  const noQuorumPattern = /\b(?:no quorum|quorum (?:was )?not (?:met|present|reached)|lack of (?:a )?quorum)\b/i;
  const minutes = parsedMinutes.flatMap((entry: any) => {
    const dateEvidence = sourceMeetingDateEvidence(parsedSections[entry.sectionIndex - 1]?.text ?? raw, item.name);
    dateReview.push({sectionIndex:entry.sectionIndex,...dateEvidence});
    if (!dateEvidence.date) return [];
    const noQuorum = noQuorumPattern.test(entry.discussion ?? '') || (parsedMinutes.length === 1 && noQuorumPattern.test(raw));
    // Quorum as the source states it (achieved / reached / not met); never
    // forced to not_recorded when the minutes say so explicitly.
    const sectionText = parsedSections[entry.sectionIndex - 1]?.text ?? (parsedMinutes.length === 1 ? raw : entry.discussion ?? '');
    const stated = quorumStatementFromText(sectionText);
    const quorum = stated.quorumStatus === 'not_recorded' && noQuorum ? { quorumStatus: 'not_met' as const, quorumMet: false } : stated;
    const notes = [...flags, 'Candidate date, attendance, motions and meeting boundaries must be compared with the original. Filename approval is not relied on.',
      noQuorum ? 'Source contains no-quorum language; deferred and future approval requests must not become adopted decisions.' : '',
      /\bDRAFT\b/i.test(raw) && /approv/i.test(item.name) ? 'Filename/content conflict: source text contains DRAFT while filename indicates approval.' : '',
      ...aliases.map(alias => `Source: ${alias.url} (${alias.path})`)].filter(Boolean).join('\n');
    return [{ ...entry, meetingDate:dateEvidence.date, meetingTitle:String(entry.meetingTitle).replace(/^\d{4}-\d{2}-\d{2}\s+/,`${dateEvidence.date} `), confidence:'Review', status:'NeedsReview', sourceExternalIds:aliases.map(alias=>`google-drive:${alias.id}`),
      sourceDocumentId: undefined, sourceDocumentTitle:item.name, notes,
      quorumMet:quorum.quorumMet, quorumStatus:quorum.quorumStatus,
      ...('quote' in quorum && quorum.quote && quorum.quorumStatus === 'confirmed' ? { quorumCheckpoints:[{ id:'source-quorum-statement', scope:'meeting', boundary:'Meeting', assertion:'confirmed',
        ...(quorum.presentCount != null ? { eligibleCount:quorum.presentCount } : {}), sourceReference:quorum.quote, sourceExternalIds:aliases.map(alias=>`google-drive:${alias.id}`) }] } : {}),
      motions:(entry.motions ?? []).map((motion:any)=>({...motion,meetingDate:dateEvidence.date,sourceExternalIds:[externalId],confidence:'Review',notes:'Outcome extracted by heuristic; verify adopted wording, vote and quorum against original.'})),
    }];
  });
  if (mayContainMinutes) meetingAudit.push({ id:item.id,name:item.name,path:item.path,url:item.url,sha256:item.sha256,
    aliases:aliases.map(x=>({id:x.id,path:x.path,url:x.url})),textStatus:item.textStatus,
    classification:minutes.length?'structured-minute-candidate':isMinutes?'minutes-needs-manual-structuring':isMeetingTitle?'meeting-document-review':'embedded-minutes-review',
    candidates:minutes.length,organizationName:owner,dateReview,
  });
  const record = { owner,sources:groupSources,meetingMinutes:minutes,documentMap:[{
    externalId,externalSystem:'google-drive',sourceExternalIds:[externalId],title:item.name,fileName:item.name,category,
    url:item.url,sha256:item.sha256,fileSizeBytes:item.bytes,sections,confidence:'Review',
    ...(extractedText ? {extractedText,extractionMethod:item.extractionMethod ?? 'document-text-extraction'} : {}),
    sensitivity:groupSources[0].sensitivity,notes:flags.join('\n'),why:`Source review targets: ${sections.join(', ')}`,
  }] };
  if (!buckets.has(owner)) buckets.set(owner, []);
  buckets.get(owner)!.push(record);
  sourceCount+=groupSources.length; minutesCount+=minutes.length;
  candidates.push({id:item.id,path:item.path,url:item.url,organizationName:owner,sections,textStatus:item.textStatus,aliases:aliases.length});
}
for (const [owner, entries] of buckets) {
  let current:any[]=[];let bytes=0;let part=0;
  const flush=()=>{
    if (!current.length) return;
    const bundle={ metadata:{name:`Drive source review ${owner?'PGAIR mentioned':'Ownership review'} ${++part}`,suggestedOrganizationName:owner||undefined,
      createdFrom:'Google Drive',sourceSystem:'google-drive',sourceFolderUrl:`https://drive.google.com/drive/folders/${manifest.rootId}`,reviewOnly:true,organizationOwnershipVerified:false,
      note:'All records stage as Pending. No automatic approvals, ledger postings, member status updates or source deletion. Ownership and extraction remain review tasks.'},
      sources:current.flatMap(x=>x.sources),documentMap:current.flatMap(x=>x.documentMap),meetingMinutes:current.flatMap(x=>x.meetingMinutes)};
    const records=recordsFromBundle(bundle);
    if (records.some((record:any)=>record.status && record.status !== 'Pending')) throw new Error('Unsafe non-pending staging record');
    const file=`${owner?'pgair':'ownership-review'}-${String(part).padStart(3,'0')}.json`;
    const data=JSON.stringify(bundle,null,2);fs.writeFileSync(path.join(destination,file),data);
    index.push({file,organizationName:owner||null,sources:bundle.sources.length,documents:bundle.documentMap.length,minutes:bundle.meetingMinutes.length,records:records.length,bytes:Buffer.byteLength(data)});
    current=[];bytes=0;
  };
  for (const entry of entries) { const size=Buffer.byteLength(JSON.stringify(entry));if(current.length&&(bytes+size>1_500_000||current.length>=25))flush();current.push(entry);bytes+=size; }flush();
}
fs.writeFileSync(path.join(destination,'index.json'),JSON.stringify({sourceCount,minutesCount,uniqueCandidates:candidates.length,bundles:index},null,2));
fs.writeFileSync(path.join(destination,'meeting-document-audit.json'),JSON.stringify(meetingAudit,null,2));
fs.writeFileSync(path.join(destination,'document-candidates.json'),JSON.stringify(candidates,null,2));
console.log(JSON.stringify({sourceCount,minutesCount,uniqueCandidates:candidates.length,bundles:index.length,meetingReviewDocuments:meetingAudit.length}));
